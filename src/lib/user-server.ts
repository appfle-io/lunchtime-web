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
