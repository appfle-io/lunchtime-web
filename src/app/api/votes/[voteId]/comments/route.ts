import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getVoteDoc, addVoteComment } from "@/lib/vote-server";

// POST /api/votes/{voteId}/comments
// body: { companyCode, content }
// 투표 참가자만 댓글을 남길 수 있다.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 예전엔 권한 체크용 getVote()(3읍기) + 댓글
// 반영 후 최신 상태 조회용 getVote() 또 한 번(3읍기) = 총 6읍기였다. addVoteComment는 원래부터
// 생성한 댓글 내용을 그대로 반환해서 추가 읍기가 필요 없었는데, 라우트가 그 반환값을 안 쓰고
// 굳이 다시 조회했던 게 낭비였다. 이제 권한 체크는 getVoteDoc()(1읍기)로 가볍게 하고, 새로 만든
// 댓글 하나만 그대로 돌려줘서 클라이언트가 vote.comments 배열 끝에 append한다.
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

  const voteSnap = await getVoteDoc(companyCode, params.voteId);
  if (!voteSnap.exists) {
    return NextResponse.json({ error: "투표를 찾을 수 없어요." }, { status: 404 });
  }
  const participantNicknameIds: string[] = voteSnap.data()?.participantNicknameIds ?? [];
  if (!participantNicknameIds.includes(session.nicknameId)) {
    return NextResponse.json({ error: "이 투표의 참가자가 아니에요." }, { status: 403 });
  }

  const comment = await addVoteComment(
    companyCode,
    params.voteId,
    session.nicknameId,
    session.nickname,
    content.trim()
  );
  return NextResponse.json({ comment });
}
