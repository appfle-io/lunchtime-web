import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getVote, respondToVote } from "@/lib/vote-server";

// POST /api/votes/{voteId}/respond
// body: { companyCode, optionId }
// 투표 참가자만 응답할 수 있다 (participantNicknameIds에 포함된 사람만).
export async function POST(request: NextRequest, { params }: { params: { voteId: string } }) {
  let body: { companyCode?: string; optionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, optionId } = body;
  if (!companyCode || !optionId) {
    return NextResponse.json({ error: "companyCode, optionId가 필요합니다." }, { status: 400 });
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const vote = await getVote(companyCode, params.voteId);
  if (!vote) {
    return NextResponse.json({ error: "투표를 찾을 수 없어요." }, { status: 404 });
  }
  if (!vote.participantNicknameIds.includes(session.nicknameId)) {
    return NextResponse.json({ error: "이 투표의 참가자가 아니에요." }, { status: 403 });
  }
  if (!vote.options.some((o) => o.id === optionId)) {
    return NextResponse.json({ error: "존재하지 않는 옵션이에요." }, { status: 400 });
  }

  await respondToVote(companyCode, params.voteId, session.nicknameId, session.nickname, optionId);
  const updated = await getVote(companyCode, params.voteId);
  return NextResponse.json({ vote: updated });
}
