import { NextRequest, NextResponse } from "next/server";
import { verifySecurityAnswer, signVerifyToken } from "@/lib/auth-server";

// POST /api/auth/forgot-password
// body: { companyCode, nickname, answer }
// 보안 질문 답변이 일치하면 PIN 재설정에 딱 한 번(10분 이내) 쓸 수 있는 단기 토큰(verifyToken)을
// 돌려준다. 로그인 상태를 요구하지 않는다 - 비밀번호를 잊은 사람이 쓰는 화면이라 당연히 세션이
// 없을 수 있다 (질문 확인은 GET /api/auth/security-question 이 담당).
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; nickname?: string; answer?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, nickname, answer } = body;
  if (!companyCode || !nickname?.trim() || !answer?.trim()) {
    return NextResponse.json({ error: "닉네임과 답변을 입력해줘." }, { status: 400 });
  }

  const result = await verifySecurityAnswer(companyCode, nickname.trim(), answer.trim());
  if (!result.ok) {
    return NextResponse.json({ error: "답변이 일치하지 않아요." }, { status: 400 });
  }

  const verifyToken = signVerifyToken({
    companyCode,
    nicknameId: result.nicknameId,
    purpose: "pin-reset",
  });

  return NextResponse.json({ verifyToken });
}
