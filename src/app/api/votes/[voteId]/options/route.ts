import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getVote, addVoteOption } from "@/lib/vote-server";

// POST /api/votes/{voteId}/options
// body: { companyCode, label, restaurantId? }
// 2026-08-11 신규: 투표를 만든 뒤에도 참가자 누구나 메뉴(식당) 옵션을 추가할 수 있게 한다(사용자
// 요청). 응답(respond)과 같은 권한 기준(이 투표의 참가자만) 사용.
export async function POST(request: NextRequest, { params }: { params: { voteId: string } }) {
  let body: { companyCode?: string; label?: string; restaurantId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, label, restaurantId } = body;
  if (!companyCode || !label?.trim()) {
    return NextResponse.json({ error: "companyCode, label이 필요합니다." }, { status: 400 });
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

  const updated = await addVoteOption(companyCode, params.voteId, {
    label: label.trim(),
    restaurantId,
  });
  if (!updated) {
    return NextResponse.json({ error: "투표를 찾을 수 없어요." }, { status: 404 });
  }

  return NextResponse.json({ vote: updated });
}
