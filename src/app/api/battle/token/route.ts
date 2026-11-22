import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import "@/lib/firebase"; // Admin 앱 초기화
import { getSessionForCompany, unauthorizedResponse } from "@/lib/api-session";
import { toBattleKey, toBattleUid } from "@/lib/battle-key";

// GET /api/battle/token?companyCode=
// 실시간 배틀(RTDB) 접속용 Firebase 커스텀 토큰 발급. 예전엔 브라우저가 인증 없이 RTDB에 직접
// 읽고 썼기 때문에 보안 규칙을 열어둘 수밖에 없었다(누구나 전 회사 배틀 데이터를 읽고 쓸 수 있음).
// 이제 로그인 세션을 확인한 뒤 회사코드(cc)/배틀키(bk) 클레임이 담긴 토큰을 내려주고,
// database.rules.json이 이 클레임으로 회사/본인 범위를 제한한다.
// 커스텀 토큰 로그인은 Firebase Authentication 무료 범위에 포함된다.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  const session = getSessionForCompany(companyCode);
  if (!session || !companyCode) return unauthorizedResponse();

  try {
    const token = await getAuth().createCustomToken(toBattleUid(companyCode, session.nicknameId), {
      cc: companyCode,
      bk: toBattleKey(session.nicknameId),
    });
    return NextResponse.json({ token });
  } catch (err) {
    console.error("[battle/token] 커스텀 토큰 발급 실패:", err);
    return NextResponse.json({ error: "실시간 배틀 인증에 실패했습니다." }, { status: 500 });
  }
}
