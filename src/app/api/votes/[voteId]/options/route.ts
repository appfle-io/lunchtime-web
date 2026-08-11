import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getVoteDoc, addVoteOption } from "@/lib/vote-server";

// POST /api/votes/{voteId}/options
// body: { companyCode, label, restaurantId? }
// 2026-08-11 신규: 투표를 만든 뒤에도 참가자 누구나 메뉴(식당) 옵션을 추가할 수 있게 한다(사용자
// 요청). 응답(respond)과 같은 권한 기준(이 투표의 참가자만) 사용.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 처음 만들었을 땐 권한 체크용 getVote()(3읍기)
// + addVoteOption 내부의 재조회(4읍기) = 클릭 한 번에 7읍기가 나가는 구조였다. 이제 권한 체크
// 단계에서 이미 읍어둔 voteSnap을 addVoteOption에 그대로 넘겨서 재사용하고, addVoteOption은
// 갱신된 options 배열만 반환한다(update 후 재조회 없음) - 클릭 한 번에 문서 1읍기 + write만 남는다.
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

  const voteSnap = await getVoteDoc(companyCode, params.voteId);
  if (!voteSnap.exists) {
    return NextResponse.json({ error: "투표를 찾을 수 없어요." }, { status: 404 });
  }
  const participantNicknameIds: string[] = voteSnap.data()?.participantNicknameIds ?? [];
  if (!participantNicknameIds.includes(session.nicknameId)) {
    return NextResponse.json({ error: "이 투표의 참가자가 아니에요." }, { status: 403 });
  }

  const options = await addVoteOption(companyCode, voteSnap, {
    label: label.trim(),
    restaurantId,
  });

  return NextResponse.json({ options });
}
