import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { addVoteComment, getVote } from "@/lib/vote-server";

// POST /api/votes/{voteId}/comments
// body: { companyCode, content }
// 투표 참가자만 댓글을 남길 수 있다.
export async function POST(request: NextRequest, { params }: { params: { voteId: string } }) {
  let body: { companyCode?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, content } = body;
  if (!companyCode || !content?.trim()) {
    return NextResponse.json({ error: "companyCode, content가 필요합니다." }, { status: 400 });
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

  await addVoteComment(companyCode, params.voteId, session.nicknameId, session.nickname, content.trim());
  const updated = await getVote(companyCode, params.voteId);
  return NextResponse.json({ vote: updated });
}
