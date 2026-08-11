import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getVote } from "@/lib/vote-server";

// GET /api/votes/{voteId}?companyCode=
// 2026-08-11 신규(firestore 과잉사용 분석 반영): 투표 목록(GET /api/votes)은 이제 responses/
// comments를 채우지 않은 가벼운 요약만 내려준다(vote-server.ts listVotesForUser 참고). 사용자가
// 투표함에서 카드를 펼쳐서 실제 응답 현황/댓글을 봐야 할 때만, 그 투표 1건에 대해서만 이
// 엔드포인트로 상세(responses+comments 포함)를 지연 로딩한다.
export async function GET(request: NextRequest, { params }: { params: { voteId: string } }) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || !companyCode || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const vote = await getVote(companyCode, params.voteId);
  if (!vote) {
    return NextResponse.json({ error: "투표를 찾을 수 없어요." }, { status: 404 });
  }
  if (!vote.participantNicknameIds.includes(session.nicknameId)) {
    return NextResponse.json({ error: "이 투표의 참가자가 아니에요." }, { status: 403 });
  }

  return NextResponse.json({ vote });
}
