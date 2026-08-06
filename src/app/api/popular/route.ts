import { NextRequest, NextResponse } from "next/server";
import { getPopularEntries } from "@/lib/popular-server";

// GET /api/popular?companyCode=xxx&limit=10
// 최근 클릭 이벤트를 집계해 인기 식당 순위를 돌려준다. 조회 전용이고 개인 데이터가 아니라
// (누가 클릭했는지가 아니라 몇 번 클릭됐는지만 다룸) 로그인 여부와 무관하게 조회 가능하게 했다
// (/api/events POST와 동일한 기준).
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const entries = await getPopularEntries(companyCode, limit);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "인기 식당 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
