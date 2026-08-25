import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase";

// 즐겨찾기 ID 목록 조회:
// 2026-08-25 최적화: 서브컬렉션 N건 개별 조회(N Read 과금) 대신 users/{nicknameId} 메인 문서의
// favoriteIds 배열 필드를 우선 읽어 1 Read로 고정한다. 필드가 없는 기존 유저는 서브컬렉션에서
// 읽어온 뒤 자동으로 유저 문서에 배열 필드를 채워넣는다 (점진적 자동 마이그레이션).
export async function listFavoriteIds(companyCode: string, nicknameId: string): Promise<string[]> {
  const userDocRef = db.collection("companies").doc(companyCode).collection("users").doc(nicknameId);
  const userSnap = await userDocRef.get();

  if (userSnap.exists) {
    const data = userSnap.data();
    if (Array.isArray(data?.favoriteIds)) {
      return data.favoriteIds as string[];
    }
  }

  // 폴백: 기존 서브컬렉션에서 읽기
  const subSnap = await userDocRef.collection("favorites").select().get();
  const ids = subSnap.docs.map((doc) => doc.id);

  // 유저 문서에 favoriteIds 배열 필드 자동 동기화 (다음 조회부터는 1 Read로 동작)
  if (userSnap.exists) {
    userDocRef.set({ favoriteIds: ids }, { merge: true }).catch(() => {});
  }

  return ids;
}

export async function setFavorite(
  companyCode: string,
  nicknameId: string,
  restaurantId: string,
  isFavorite: boolean
): Promise<void> {
  const userDocRef = db.collection("companies").doc(companyCode).collection("users").doc(nicknameId);
  const subDocRef = userDocRef.collection("favorites").doc(restaurantId);

  // 1. 메인 유저 문서의 favoriteIds 배열 원자적(Atomic) 업데이트
  const userUpdate = isFavorite
    ? { favoriteIds: FieldValue.arrayUnion(restaurantId) }
    : { favoriteIds: FieldValue.arrayRemove(restaurantId) };

  // 2. 서브컬렉션과 배열 필드 동시 반영 (하위 호환성 100% 보장)
  await Promise.all([
    userDocRef.set(userUpdate, { merge: true }),
    isFavorite ? subDocRef.set({ createdAt: new Date().toISOString() }) : subDocRef.delete(),
  ]);
}
