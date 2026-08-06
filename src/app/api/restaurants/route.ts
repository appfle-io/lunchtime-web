import { NextRequest, NextResponse } from "next/server";
import { addRestaurantManually } from "@/lib/restaurant-server";

// POST /api/restaurants
// body: { companyCode: string, name: string, addressHint?: string }
// 자동 시딩에서 빠진 식당을 사용자가 직접 추가할 때 호출한다.
// 네이버 지역검색으로 이름(+주소 힌트)에 맞는 곳을 찾아서 companies/{code}/restaurants에 저장한다.
// 이미 같은 식당이 있으면 새로 만들지 않고 existing:true로 기존 항목을 그대로 돌려준다.
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
    const result = await addRestaurantManually(companyCode, name.trim(), addressHint?.trim());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "식당 추가 중 오류가 발생했습니다." },
      { status: 400 }
    );
  }
}
