import { NextRequest, NextResponse } from "next/server";
import {
  verifyVerifyToken,
  resetPin,
  signSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth-server";
import { toNicknameId } from "@/lib/nickname";

// POST /api/auth/reset-pin
// body: { companyCode, nickname, verifyToken, newPin }
// forgot-password에서 받은 verifyToken(10분 유효)이 이 닉네임/회사와 정확히 일치해야만 PIN을
// 바꿀 수 있다. 성공하면 곧바로 로그인 상태로 만들어준다(세션 쿠키 발급) - 비밀번호를 다시 찾은
// 직후에 또 로그인 폼으로 돌려보내는 건 불필요한 마찰이라고 판단했다.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; nickname?: string; verifyToken?: string; newPin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, nickname, verifyToken, newPin } = body;
  if (!companyCode || !nickname?.trim() || !verifyToken || !newPin) {
    return NextResponse.json({ error: "필요한 정보가 부족합니다." }, { status: 400 });
  }
  if (!/^\d{4}$/.test(newPin)) {
    return NextResponse.json({ error: "PIN은 숫자 4자리로 입력해줘." }, { status: 400 });
  }

  const payload = verifyVerifyToken(verifyToken);
  const nicknameId = toNicknameId(nickname.trim());
  if (
    !payload ||
    payload.purpose !== "pin-reset" ||
    payload.companyCode !== companyCode ||
    payload.nicknameId !== nicknameId
  ) {
    return NextResponse.json(
      { error: "인증이 만료됐거나 올바르지 않아요. 다시 시도해줘." },
      { status: 400 }
    );
  }

  const result = await resetPin(companyCode, nicknameId, newPin);

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const token = signSessionToken({ companyCode, nicknameId, nickname: result.nickname, exp });

  const response = NextResponse.json({ status: "ok" });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
