import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  verifySessionToken,
  SESSION_COOKIE_NAME,
  getSecurityQuestion,
  setSecurityQuestion,
} from "@/lib/auth-server";

// GET /api/auth/security-question?companyCode=&nickname=
// 로그인 여부와 무관하게 동작한다 - 비밀번호를 잊은 사람이 쓰는 화면(로그인 안 된 상태)에서도
// 호출해야 하기 때문. 질문 텍스트만 돌려주고 답변 해시는 절대 내려주지 않는다.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  const nickname = request.nextUrl.searchParams.get("nickname");
  if (!companyCode || !nickname) {
    return NextResponse.json({ error: "companyCode, nickname이 필요합니다." }, { status: 400 });
  }

  const result = await getSecurityQuestion(companyCode, nickname);
  if (!result) {
    return NextResponse.json(
      { error: "이 계정에는 비밀번호 찾기용 질문이 설정되어 있지 않아요." },
      { status: 404 }
    );
  }
  return NextResponse.json(result);
}

// POST /api/auth/security-question
// body: { companyCode, question, answer }
// 로그인된 본인 계정에만 설정할 수 있다(session 필요) - 가입 직후(AuthGate) 또는 로그인한 상태의
// '비밀번호 변경' 플로우(PinResetModal)에서 아직 질문이 없는 계정에 새로 등록할 때 호출한다.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; question?: string; answer?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, question, answer } = body;
  if (!companyCode || !question?.trim() || !answer?.trim()) {
    return NextResponse.json({ error: "질문과 답변을 모두 입력해줘." }, { status: 400 });
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  await setSecurityQuestion(companyCode, session.nicknameId, question.trim(), answer.trim());
  return NextResponse.json({ status: "ok" });
}
