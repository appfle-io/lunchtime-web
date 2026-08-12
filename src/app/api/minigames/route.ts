import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getMiniGameRanking, saveMiniGameResult, type MiniGameRankingPeriod } from "@/lib/minigame-server";
import type { MiniGameParticipant, MiniGameTeam, MiniGameType } from "@/types";

function getSession(request: NextRequest, companyCode: string | null) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || !companyCode || session.companyCode !== companyCode) return null;
  return session;
}

// GET /api/minigames?companyCode=&period=week|month|all - 미니게임 당첨 랭킹 조회.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  const periodParam = request.nextUrl.searchParams.get("period");
  const period: MiniGameRankingPeriod =
    periodParam === "week" || periodParam === "month" || periodParam === "all" ? periodParam : "week";

  const session = getSession(request, companyCode);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const ranking = await getMiniGameRanking(companyCode, period);
  return NextResponse.json({ ranking });
}

// POST /api/minigames - 미니게임 결과 저장.
// body: { companyCode, type, winnerCount?, winners?, teamCount?, teams?, leftover?, participants }
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    type?: MiniGameType;
    winnerCount?: number;
    winners?: MiniGameParticipant[];
    teamCount?: number;
    teams?: MiniGameTeam[];
    leftover?: MiniGameParticipant[];
    participants?: MiniGameParticipant[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, type, winnerCount, winners, teamCount, teams, leftover, participants } = body;
  const session = getSession(request, companyCode ?? null);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!type || !participants || participants.length === 0) {
    return NextResponse.json({ error: "게임 종류와 참가자 목록이 필요합니다." }, { status: 400 });
  }

  const result = await saveMiniGameResult(companyCode, {
    type,
    winnerCount,
    winners,
    teamCount,
    teams,
    leftover,
    participants,
    createdByNicknameId: session.nicknameId,
    createdByNickname: session.nickname,
  });

  return NextResponse.json({ result });
}
