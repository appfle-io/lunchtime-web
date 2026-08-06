import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { listCompanyUsers } from "@/lib/user-server";

// GET /api/users?companyCode= - 친구 검색용, 같은 회사 사용자 닉네임 목록 (로그인 필요, 본인 제외).
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const users = await listCompanyUsers(companyCode);
  return NextResponse.json({ users: users.filter((u) => u.nicknameId !== session.nicknameId) });
}
