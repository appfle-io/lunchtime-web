import { db } from "@/lib/firebase";
import { toNicknameId } from "@/lib/nickname";

export interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

// 친구 검색/추가용 - 회사 내 전체 사용자 닉네임 목록. PIN 해시/salt 같은 민감 필드는 절대
// select()로도 포함하지 않는다 (2026-08-06, 친구목록 기능 추가하면서 신규).
export async function listCompanyUsers(companyCode: string): Promise<CompanyUserEntry[]> {
  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .select("nickname")
    .get();

  return snapshot.docs.map((doc) => ({ nicknameId: doc.id, nickname: doc.data().nickname }));
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
