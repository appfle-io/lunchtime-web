import { NextRequest, NextResponse } from "next/server";
import { searchRestaurantCandidates } from "@/lib/restaurant-server";

// POST /api/restaurants/search
// body: { companyCode: string, name: string, addressHint?: string }
// "직접 추가" 2단계 플로우의 1단계. 이름(+선택적 위치 힌트)으로 네이버 지역검색 후보들을 모아서
// 회사에서 가까운 순으로 정렬해 돌려준다 (최대 10건). 사용자가 이 중에서 실제로 맞는 곳을 골라야
// POST /api/restaurants로 저장된다 - 여기서는 자동으로 하나를 확정하지 않는다(2026-08-06 개편,
// "궁중삼계탕" 자동매칭 반복 실패 이후 사용자 제안으로 도입).
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; name?: string; addressHint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, name, addressHint } = body;
  if (!companyCode || !name || !name.trim()) {
    return NextResponse.json(
      { error: "companyCode와 name은 필수입니다." },
      { status: 400 }
    );
  }

  try {
    const candidates = await searchRestaurantCandidates(companyCode, name.trim(), addressHint?.trim());
    return NextResponse.json({ candidates });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "검색 중 오류가 발생했습니다." },
      { status: 400 }
    );
  }
}
