import { NextRequest, NextResponse } from "next/server";
import { getRestaurantActivity } from "@/lib/restaurant-server";

// GET /api/restaurants/{restaurantId}/activity?companyCode=
// 2026-08-11 신규(RestaurantDetail 재오픈 캐시 개선 - "방법 A"): 식당 상세모달을 다시 열었을 때
// reviews/zeropay-votes 전체를 매번 다시 불러오는 대신, 식당 문서의 lastActivityAt 필드 하나만
// 가볍게 확인한다. 이 값이 클라이언트가 캐시해둔 값과 같으면(그 사이 다른 동료가 댓글을 달거나
// 제로페이 투표를 하지 않았다는 뜻) reviews/제로페이 상태는 캐시를 그대로 쓰고, 다르면 그때만
// 진짜로 다시 불러온다(RestaurantDetail.tsx 참고). 인증 없이 조회 가능 - 민감한 정보가 아니고
// GET /api/reviews, GET /api/zeropay-votes도 동일하게 인증 없이 열려 있다.
export async function GET(request: NextRequest, { params }: { params: { restaurantId: string } }) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const lastActivityAt = await getRestaurantActivity(companyCode, params.restaurantId);
  return NextResponse.json({ lastActivityAt });
}
