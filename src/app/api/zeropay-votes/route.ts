import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { getZeroPayStatus, setZeroPayVote } from "@/lib/zeropay-server";

// GET /api/zeropay-votes?companyCode=&restaurantId=
// 특정 식당의 제로페이 엄지척 투표 현황 조회. 로그인 세션이 있으면 내 투표(myVote)도 같이 내려준다.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyCode = searchParams.get("companyCode");
  const restaurantId = searchParams.get("restaurantId");

  if (!companyCode || !restaurantId) {
    return NextResponse.json(
      { error: "companyCode, restaurantId가 필요합니다." },
      { status: 400 }
    );
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  const nicknameId = session && session.companyCode === companyCode ? session.nicknameId : null;

  const status = await getZeroPayStatus(companyCode, restaurantId, nicknameId);
  return NextResponse.json(status);
}

// POST /api/zeropay-votes
// body: { companyCode, restaurantId, vote: "up" | "down" }
// 같은 버튼을 다시 누르면 투표가 취소된다(토글) - lib/zeropay-server.ts 참고.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; restaurantId?: string; vote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId, vote } = body;
  if (!companyCode || !restaurantId || (vote !== "up" && vote !== "down")) {
    return NextResponse.json(
      { error: "companyCode, restaurantId, vote(up/down)가 필요합니다." },
      { status: 400 }
    );
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const status = await setZeroPayVote(companyCode, restaurantId, session.nicknameId, vote);
  return NextResponse.json(status);
}
