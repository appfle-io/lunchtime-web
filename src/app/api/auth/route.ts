import { NextRequest, NextResponse } from "next/server";
import { authenticate, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-server";
import { normalizeCompanyCode, isValidCompanyCode } from "@/lib/company";

// POST /api/auth
// body: { companyCode, nickname, pin }
// 회사코드+닉네임+PIN 가입/로그인 통합 처리. 성공하면 세션 쿠키를 심어준다.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; nickname?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, nickname, pin } = body;
  if (!companyCode || !nickname?.trim() || !pin) {
    return NextResponse.json(
      { error: "회사코드, 닉네임, PIN을 모두 입력해줘." },
      { status: 400 }
    );
  }
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "PIN은 숫자 4자리로 입력해줘." }, { status: 400 });
  }

  const code = normalizeCompanyCode(companyCode);
  if (!isValidCompanyCode(code)) {
    return NextResponse.json({ error: "존재하지 않는 회사코드입니다." }, { status: 404 });
  }

  try {
    const result = await authenticate(code, nickname, pin);

    if (result.status === "invalid-nickname") {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    if (result.status === "no-company") {
      return NextResponse.json({ error: "존재하지 않는 회사코드입니다." }, { status: 404 });
    }

    if (result.status === "locked") {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);
      return NextResponse.json(
        { error: `PIN을 여러 번 틀려서 잠겼어요. ${minutes}분 뒤에 다시 시도해줘.` },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    }

    if (result.status === "conflict") {
      return NextResponse.json(
        { status: "conflict", suggestion: result.suggestion },
        { status: 409 }
      );
    }

    const response = NextResponse.json({ status: result.status, nickname: result.nickname });
    response.cookies.set(SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    console.error("[auth] 로그인 처리 실패:", err);
    return NextResponse.json({ error: "로그인 중 오류가 발생했어." }, { status: 500 });
  }
}

// DELETE /api/auth - 로그아웃 (세션 쿠키 제거)
export async function DELETE() {
  const response = NextResponse.json({ status: "logged-out" });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
