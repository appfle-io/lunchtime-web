import { db } from "@/lib/firebase";

// 2026-08-09 신규: "사용자 수정요청" + "관리자 페이지" 기능을 위한 권한 확인 헬퍼.
// isAdmin은 회사코드에 관계없이 범용적으로 설계 - companies/{code}/users/{nicknameId} 문서에
// isAdmin: true 필드만 있으면 그 회사의 관리자다. 처음엔 ssg 회사의 "시우야밥먹자" 계정 하나만
// 해당하지만, 나중에 다른 회사가 붙어도 코드 변경 없이 그 회사 사용자 문서에 같은 필드만
// 추가해주면 된다 (scripts/set-admin.ts로 설정).
//
// 세션 토큰(auth-server.ts)에 isAdmin을 같이 구워넣지 않는 이유: 세션은 180일짜리라, 토큰에
// 구워두면 나중에 관리자 권한을 회수해도(isAdmin: false로 바꿔도) 그 사람 세션이 만료되기
// 전까지는 계속 관리자로 인식된다. 이 헬퍼는 관리자 페이지 진입/API 호출마다 Firestore를 한 번
// 더 읽는 비용을 감수하고, 항상 최신 상태를 보도록 한다.
export async function isAdminUser(companyCode: string, nicknameId: string): Promise<boolean> {
  const doc = await db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .get();
  if (!doc.exists) return false;
  return Boolean(doc.data()?.isAdmin);
}

// 수정요청이 새로 들어왔을 때 "회사의 모든 관리자"에게 알림을 보내기 위한 목록 조회.
// 관리자가 여러 명일 수 있다는 걸 전제로 배열을 돌려준다.
export async function listAdminNicknameIds(companyCode: string): Promise<string[]> {
  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .where("isAdmin", "==", true)
    .get();
  return snapshot.docs.map((doc) => doc.id);
}
