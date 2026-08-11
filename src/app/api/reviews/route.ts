import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listReviews, addReview } from "@/lib/review-server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";

// GET /api/reviews?companyCode=&restaurantId= - 특정 식당의 댓글 목록 조회
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

  const reviews = await listReviews(companyCode, restaurantId);
  return NextResponse.json({ reviews });
}

// POST /api/reviews - 댓글 작성. 작성자는 클라이언트가 보낸 값이 아니라
// 로그인 세션에서 가져온 닉네임을 그대로 쓴다 (다른 사람 이름으로 글 남기는 걸 막기 위함).
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; restaurantId?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId, content } = body;
  if (!companyCode || !restaurantId || !content?.trim()) {
    return NextResponse.json(
      { error: "companyCode, restaurantId, content가 필요합니다." },
      { status: 400 }
    );
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const result = await addReview(companyCode, restaurantId, session.nickname, content.trim());
  return NextResponse.json({ review: result.review, lastActivityAt: result.lastActivityAt });
}
