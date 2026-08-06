import { NextRequest, NextResponse } from "next/server";
import { logRestaurantEvent } from "@/lib/analytics-server";

// POST /api/events
// body: { companyCode, restaurantId, type: "click" }
// 통계 수집용 - 실시간 인기 Top3(추후 구현) 등에 쓸 클릭 이벤트를 쌓는다.
// 익명 집계용 데이터라 로그인 여부와 무관하게 기록하고, 세션 체크는 하지 않는다.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; restaurantId?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId, type } = body;
  if (!companyCode || !restaurantId || type !== "click") {
    return NextResponse.json(
      { error: "companyCode, restaurantId, type(click)이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    await logRestaurantEvent(companyCode, restaurantId, "click");
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    // 통계 수집 실패가 사용자 경험을 막으면 안 되므로, 클라이언트는 이 응답을 그냥 무시하고 넘어간다.
    return NextResponse.json(
      { error: (err as Error).message ?? "이벤트 기록에 실패했습니다." },
      { status: 500 }
    );
  }
}
