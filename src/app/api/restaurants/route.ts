import { NextResponse } from "next/server";
import { addRestaurantFromCandidate } from "@/lib/restaurant-server";
import { getSessionForCompany, unauthorizedResponse } from "@/lib/api-session";

// POST /api/restaurants
//
// "직접 추가" 2단계 플로우의 2단계. 사용자가 POST /api/restaurants/search 결과 중 직접 고른 후보를
// 검증 없이 그대로 저장한다(사용자가 이미 상호명+주소를 보고 확인했으므로). 이미 같은 식당(같은 id)이
// 있으면 새로 만들지 않고 existing:true로 기존 데이터를 돌려준다.
//
// 새로 만든 경우 응답 전에 enrichRestaurantById()로 네이버 플레이스 정보와 제로페이 공식 사이트
// 판정(lib/zeropay-official.ts)을 함께 채운다. 제로페이는 공식 사이트에서 확정된 경우에만 지원으로 표시된다.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { companyCode, candidate } = body ?? {};

    if (!companyCode || typeof companyCode !== "string") {
      return NextResponse.json({ error: "companyCode가 필요해요." }, { status: 400 });
    }

    // 식당 문서 쓰기 + 외부 수집(네이버/제로페이)을 일으키는 요청이라 같은 회사 로그인 사용자만 허용한다.
    if (!getSessionForCompany(companyCode)) return unauthorizedResponse();

    if (
      !candidate ||
      typeof candidate.title !== "string" ||
      typeof candidate.address !== "string" ||
      typeof candidate.lat !== "number" ||
      typeof candidate.lng !== "number"
    ) {
      return NextResponse.json(
        { error: "candidate(title, address, lat, lng) 정보가 유효하지 않아요." },
        { status: 400 }
      );
    }

    const result = await addRestaurantFromCandidate(companyCode, candidate);

    // 새로 만들어진 경우 공식 제로페이 검증 및 네이버 플레이스 상세 정보(전화번호, 영업시간, 메뉴 등)를 동기 수집
    if (!result.existing) {
      try {
        const { enrichRestaurantById } = await import("@/lib/enrich-server");
        const enrichResult = await enrichRestaurantById(companyCode, result.restaurant.id);
        return NextResponse.json({
          ...result,
          restaurant: enrichResult.restaurant,
        });
      } catch (enrichErr) {
        console.error(`[enrich] "${candidate.title}" 동기 수집 실패 (기존 후보 정보 반환):`, enrichErr);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message ?? "식당을 추가하지 못했어요.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
