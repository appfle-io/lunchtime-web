import { NextRequest, NextResponse } from "next/server";
import { logRestaurantEvent } from "@/lib/analytics-server";
import { getSessionForCompany, unauthorizedResponse } from "@/lib/api-session";

// POST /api/events
// body: { companyCode, restaurantId, type: "click" }
// 통계 수집용 - 실시간 인기 Top3(추후 구현) 등에 쓸 클릭 이벤트를 쌓는다.
// 집계 자체는 익명이지만, 비로그인 요청이 임의 회사 경로에 쓰기(과금)를 만들지 못하도록 세션은 확인한다.
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

  if (!getSessionForCompany(companyCode)) return unauthorizedResponse();
  if (restaurantId.length > 100 || /[./]/.test(restaurantId)) {
    return NextResponse.json({ error: "restaurantId가 올바르지 않습니다." }, { status: 400 });
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
