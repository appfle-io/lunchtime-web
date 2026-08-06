import { NextRequest, NextResponse } from "next/server";
import { addRestaurantFromCandidate } from "@/lib/restaurant-server";

// POST /api/restaurants
// body: { companyCode: string, candidate: { title, address, lat, lng, category } }
// "직접 추가" 2단계 플로우의 2단계. 사용자가 POST /api/restaurants/search 결과 중 직접 고른 후보를
// 그대로 companies/{code}/restaurants에 저장한다 (2026-08-06 개편 - 예전엔 name/addressHint를
// 받아서 서버가 자동으로 후보 하나를 확정했는데, "궁중삼계탕" 사례처럼 자동 매칭이 반복 실패해서
// 사용자가 직접 후보를 보고 고르는 방식으로 바꿈).
// 이미 같은 식당이 있으면 새로 만들지 않고 existing:true로 기존 항목을 그대로 돌려준다.
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    candidate?: { title?: string; address?: string; lat?: number; lng?: number; category?: string | null };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, candidate } = body;
  if (
    !companyCode ||
    !candidate ||
    !candidate.title ||
    !candidate.address ||
    typeof candidate.lat !== "number" ||
    typeof candidate.lng !== "number"
  ) {
    return NextResponse.json(
      { error: "companyCode와 candidate(title/address/lat/lng)는 필수입니다." },
      { status: 400 }
    );
  }

  try {
    const result = await addRestaurantFromCandidate(companyCode, {
      title: candidate.title,
      address: candidate.address,
      lat: candidate.lat,
      lng: candidate.lng,
      category: candidate.category ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "식당 추가 중 오류가 발생했습니다." },
      { status: 400 }
    );
  }
}
