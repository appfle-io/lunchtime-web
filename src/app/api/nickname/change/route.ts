import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, issueToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-server";
import { changeUserNickname } from "@/lib/user-server";

// POST /api/nickname/change
// body: { newNickname }
// 로그인된 사용자의 닉네임을 변경하고, 새 세션 쿠키를 발급한다.
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);

  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { newNickname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { newNickname } = body ?? {};
  if (!newNickname || !newNickname.trim()) {
    return NextResponse.json({ error: "새 닉네임을 입력해주세요." }, { status: 400 });
  }

  const trimmedNickname = newNickname.trim();
  if (trimmedNickname.length > 20) {
    return NextResponse.json({ error: "닉네임은 20자 이하로 입력해주세요." }, { status: 400 });
  }

  try {
    const { newNicknameId, newNickname: updatedNickname } = await changeUserNickname(
      session.companyCode,
      session.nicknameId,
      trimmedNickname
    );

    const newToken = issueToken(session.companyCode, newNicknameId, updatedNickname);
    const response = NextResponse.json({
      ok: true,
      nickname: updatedNickname,
      nicknameId: newNicknameId,
    });

    response.cookies.set(SESSION_COOKIE_NAME, newToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (err) {
    const msg = (err as Error).message ?? "닉네임 변경 중 오류가 발생했습니다.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
