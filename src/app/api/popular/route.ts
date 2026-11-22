import { NextRequest, NextResponse } from "next/server";
import { getPopularEntries } from "@/lib/popular-server";
import { getSessionForCompany, unauthorizedResponse } from "@/lib/api-session";

// GET /api/popular?companyCode=xxx&limit=10
// 최근 클릭 이벤트를 집계해 인기 식당 순위를 돌려준다. 개인 데이터는 아니지만 비로그인 요청이
// 다른 회사 경로의 Firestore 읽기를 일으키지 않도록 같은 회사 세션을 요구한다.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  if (!getSessionForCompany(companyCode)) return unauthorizedResponse();

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
