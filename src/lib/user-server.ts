import { db } from "@/lib/firebase";
import { toNicknameId } from "@/lib/nickname";

export interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

// 2026-08-11 신규(페이지 로드 캐싱 2차 개선): listCompanyUsers()는 companyCode당 회사 전체
// 사용자를 스캔한다. 예전엔 CompanyHome 마운트(페이지 진입/새로고침)마다 캐시 없이 매번 이
// 스캔이 나갔다 - 회사 사용자 목록은 누군가 새로 가입할 때만 바뀌는 데이터라, restaurant-server.ts
// 의 restaurantsCache와 같은 패턴(짧은 TTL 인메모리 캐시)을 그대로 적용한다. 신규 가입 시점
// (auth-server.ts의 authenticate())에서 invalidateCompanyUsersCache()를 호출해 즉시
// 무효화하므로, 여기 TTL은 그 사이(다른 서버 인스턴스에서의 가입 등)를 대비한 안전망일 뿐이다.
const COMPANY_USERS_CACHE_TTL_MS = 5 * 60 * 1000;
const companyUsersCache = new Map<string, { data: CompanyUserEntry[]; expiresAt: number }>();

export function invalidateCompanyUsersCache(companyCode: string): void {
  companyUsersCache.delete(companyCode);
}

// 친구 검색/추가용 - 회사 내 전체 사용자 닉네임 목록. PIN 해시/salt 같은 민감 필드는 절대
// select()로도 포함하지 않는다 (2026-08-06, 친구목록 기능 추가하면서 신규).
export async function listCompanyUsers(companyCode: string): Promise<CompanyUserEntry[]> {
  const cached = companyUsersCache.get(companyCode);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .select("nickname")
    .get();

  const users = snapshot.docs.map((doc) => ({ nicknameId: doc.id, nickname: doc.data().nickname }));
  companyUsersCache.set(companyCode, { data: users, expiresAt: Date.now() + COMPANY_USERS_CACHE_TTL_MS });
  return users;
}

export async function findUserByNickname(
  companyCode: string,
  nickname: string
): Promise<CompanyUserEntry | null> {
  const nicknameId = toNicknameId(nickname);
  const doc = await db.collection("companies").doc(companyCode).collection("users").doc(nicknameId).get();
  if (!doc.exists) return null;
  return { nicknameId, nickname: doc.data()!.nickname };
}

/**
 * 닉네임 변경 처리:
 * 1. 새 닉네임 중복 검사
 * 2. 기존 users/{oldNicknameId} 문서 및 서브컬렉션(favorites, friends, mealLogs, notifications)을 users/{newNicknameId}로 이전
 * 3. 타 사용자의 friends 서브컬렉션에서 oldNicknameId 참조를 newNicknameId로 자동 동기화 (기존 memo 및 addedAt 보존)
 * 4. 회사 사용자 목록 캐시 무효화
 */
export async function changeUserNickname(
  companyCode: string,
  oldNicknameId: string,
  rawNewNickname: string
): Promise<{ newNicknameId: string; newNickname: string }> {
  const newNickname = rawNewNickname.trim();
  if (!newNickname) {
    throw new Error("새 닉네임을 입력해주세요.");
  }
  if (newNickname.length > 20) {
    throw new Error("닉네임은 20자 이하로 입력해주세요.");
  }
  const newNicknameId = toNicknameId(newNickname);
  if (newNicknameId === oldNicknameId) {
    throw new Error("현재 닉네임과 동일합니다.");
  }

  const usersCol = db.collection("companies").doc(companyCode).collection("users");
  const oldUserRef = usersCol.doc(oldNicknameId);
  const newUserRef = usersCol.doc(newNicknameId);

  const [oldDoc, newDoc] = await Promise.all([oldUserRef.get(), newUserRef.get()]);

  if (!oldDoc.exists) {
    throw new Error("사용자 정보를 찾을 수 없습니다.");
  }
  if (newDoc.exists) {
    throw new Error("이미 사용 중인 닉네임입니다.");
  }

  const oldData = oldDoc.data()!;
  const newData = {
    ...oldData,
    nickname: newNickname,
    updatedAt: new Date().toISOString(),
  };

  // 1. 서브컬렉션 문서들 조회
  const [favoritesSnap, friendsSnap, mealLogsSnap, notifsSnap] = await Promise.all([
    oldUserRef.collection("favorites").get(),
    oldUserRef.collection("friends").get(),
    oldUserRef.collection("mealLogs").get(),
    oldUserRef.collection("notifications").get(),
  ]);

  // Firestore 배치 작업 (기존 유저 -> 새 유저 마이그레이션)
  const batch = db.batch();

  // 새 유저 문서 생성 및 이전 문서 삭제
  batch.set(newUserRef, newData);
  batch.delete(oldUserRef);

  // 서브컬렉션 마이그레이션
  for (const doc of favoritesSnap.docs) {
    batch.set(newUserRef.collection("favorites").doc(doc.id), doc.data());
    batch.delete(doc.ref);
  }
  for (const doc of friendsSnap.docs) {
    batch.set(newUserRef.collection("friends").doc(doc.id), doc.data());
    batch.delete(doc.ref);
  }
  for (const doc of mealLogsSnap.docs) {
    batch.set(newUserRef.collection("mealLogs").doc(doc.id), doc.data());
    batch.delete(doc.ref);
  }
  for (const doc of notifsSnap.docs) {
    batch.set(newUserRef.collection("notifications").doc(doc.id), doc.data());
    batch.delete(doc.ref);
  }

  await batch.commit();

  // 2. 다른 사용자의 friends 컬렉션에서 oldNicknameId 참조 마이그레이션
  try {
    const allUsersSnap = await usersCol.select().get();
    const otherUserIds = allUsersSnap.docs
      .map((d) => d.id)
      .filter((id) => id !== oldNicknameId && id !== newNicknameId);

    if (otherUserIds.length > 0) {
      const friendChecks = await Promise.all(
        otherUserIds.map((uId) => usersCol.doc(uId).collection("friends").doc(oldNicknameId).get())
      );

      const friendBatch = db.batch();
      let friendBatchCount = 0;

      for (const fSnap of friendChecks) {
        if (fSnap.exists) {
          const fData = fSnap.data()!;
          const parentUserRef = fSnap.ref.parent.parent;
          if (parentUserRef) {
            const newFriendRef = parentUserRef.collection("friends").doc(newNicknameId);
            friendBatch.set(newFriendRef, {
              ...fData,
              nickname: newNickname,
            });
            friendBatch.delete(fSnap.ref);
            friendBatchCount++;
          }
        }
      }

      if (friendBatchCount > 0) {
        await friendBatch.commit();
      }
    }
  } catch (syncErr) {
    console.warn(`[changeUserNickname] 친구 목록 동기화 중 경고 (계속 진행):`, syncErr);
  }

  // 캐시 무효화
  invalidateCompanyUsersCache(companyCode);

  return { newNicknameId, newNickname };
}

