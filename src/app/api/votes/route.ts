import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { createVote, listVotesForUser } from "@/lib/vote-server";
import { listCompanyUsers } from "@/lib/user-server";
import { createNotification } from "@/lib/notification-server";

function getSession(request: NextRequest, companyCode: string | null) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || !companyCode || session.companyCode !== companyCode) return null;
  return session;
}

// GET /api/votes?companyCode= - 내가 참가자로 포함된 투표 전체(오늘 것 + 히스토리) 조회.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  const session = getSession(request, companyCode);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const votes = await listVotesForUser(companyCode, session.nicknameId);
  return NextResponse.json({ votes });
}

// POST /api/votes
// body: { companyCode, title, options: [{restaurantId?, label}], participantNicknameIds: string[] }
// 2026-08-06 3차: 예전엔 "내(작성자) 친구목록에 있는 사람만" 초대 가능하게 제한했는데, 사용자
// 요청으로 "참가자 초대는 아무나 가능"하게 완화했다(친구목록은 그저 빠르게 고르는 UI 보조일
// 뿐, 서버 쪽 제약은 아니다). 대신 존재하지 않는 nicknameId(오타/조작된 값)가 섞여 들어오는
// 것만 막는다. 초대된 참가자에게는 알림을 남긴다.
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    title?: string;
    options?: { restaurantId?: string; label?: string }[];
    participantNicknameIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, title, options, participantNicknameIds } = body;
  const session = getSession(request, companyCode ?? null);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!options || options.length === 0) {
    return NextResponse.json({ error: "메뉴(식당) 옵션을 1개 이상 골라줘." }, { status: 400 });
  }
  const cleanOptions = options
    .filter((o) => o.label?.trim())
    .map((o) => ({ label: o.label!.trim(), restaurantId: o.restaurantId }));
  if (cleanOptions.length === 0) {
    return NextResponse.json({ error: "메뉴(식당) 옵션을 1개 이상 골라줘." }, { status: 400 });
  }

  const requestedParticipants = Array.from(new Set(participantNicknameIds ?? []));
  if (requestedParticipants.length > 0) {
    const companyUsers = await listCompanyUsers(companyCode);
    const validIds = new Set(companyUsers.map((u) => u.nicknameId));
    const invalid = requestedParticipants.filter(
      (id) => id !== session.nicknameId && !validIds.has(id)
    );
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "존재하지 않는 사용자가 참가자 목록에 포함되어 있어요." },
        { status: 400 }
      );
    }
  }

  const vote = await createVote(
    companyCode,
    session.nicknameId,
    session.nickname,
    title ?? "",
    cleanOptions,
    requestedParticipants
  );

  await Promise.all(
    requestedParticipants.map((nicknameId) =>
      createNotification(companyCode, nicknameId, {
        type: "voteCreated",
        voteId: vote.id,
        voteTitle: vote.title,
        creatorNickname: session.nickname,
      })
    )
  );

  return NextResponse.json({ vote });
}
