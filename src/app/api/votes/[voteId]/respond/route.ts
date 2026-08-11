import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getVoteDoc, respondToVote, SEPARATE_OPTION_ID, type VoteOption } from "@/lib/vote-server";

// POST /api/votes/{voteId}/respond
// body: { companyCode, optionId }
// 투표 참가자만 응답할 수 있다 (participantNicknameIds에 포함된 사람만).
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 예전엔 권한 체크용으로 getVote()(문서+
// responses+comments, 3읍기)를 부르고, 응답 반영 후 최신 상태를 돌려주려고 getVote()를 또
// 불렀다(총 6~7읍기). 이제 권한 체크는 getVoteDoc()(문서만, 1읍기)로 가볍게 하고, 응답 반영
// 결과는 respondToVote()가 직접 돌려주는 델타(removed/entry)만 그대로 클라이언트에 전달한다.
// 클라이언트가 이미 들고 있는 vote.responses 배열에 이 델타를 병합하므로 서버가 전체 vote를
// 다시 조립해서 돌려줄 필요가 없다.
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

  const voteSnap = await getVoteDoc(companyCode, params.voteId);
  if (!voteSnap.exists) {
    return NextResponse.json({ error: "투표를 찾을 수 없어요." }, { status: 404 });
  }
  const data = voteSnap.data()!;
  const participantNicknameIds: string[] = data.participantNicknameIds ?? [];
  if (!participantNicknameIds.includes(session.nicknameId)) {
    return NextResponse.json({ error: "이 투표의 참가자가 아니에요." }, { status: 403 });
  }
  const optionIds = new Set<string>([...(data.options ?? []).map((o: VoteOption) => o.id), SEPARATE_OPTION_ID]);
  if (!optionIds.has(optionId)) {
    return NextResponse.json({ error: "존재하지 않는 옵션이에요." }, { status: 400 });
  }

  const result = await respondToVote(companyCode, params.voteId, session.nicknameId, session.nickname, optionId);
  return NextResponse.json(result);
}
