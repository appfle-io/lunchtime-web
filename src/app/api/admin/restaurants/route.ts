import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { resolveNaverPlaceId } from "@/lib/naver-place-detail";
import { updateRestaurantAdminFields, type RestaurantAdminUpdate } from "@/lib/restaurant-server";

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

// PATCH /api/admin/restaurants
// body: { companyCode, restaurantId, update: RestaurantAdminUpdate }
// 관리자 페이지에서 가맹점 정보를 직접 수정한다. 관리자 권한이 없으면 403.
export async function PATCH(request: NextRequest) {
  let body: { companyCode?: string; restaurantId?: string; update?: RestaurantAdminUpdate };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId, update } = body;
  if (!companyCode || !restaurantId || !update) {
    return NextResponse.json(
      { error: "companyCode, restaurantId, update가 필요합니다." },
      { status: 400 }
    );
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  // 관리자가 네이버 지도 링크를 새로 넣거나 바꾼 경우: 그 플레이스를 "관리자 지정"으로 연결한다.
  // (예전엔 문서에 남아 있던 옛 naverPlaceId가 먼저 쓰여서, 링크를 고쳐도 잘못된 가게 정보가 다시 붙었다.)
  // 폼은 저장할 때마다 링크를 같이 보내므로, 플레이스 ID가 실제로 바뀐 경우에만 지정으로 바꾼다.
  const extra: Record<string, unknown> = {};
  if (update.naverPlaceUrl && update.naverPlaceUrl.trim()) {
    const newPlaceId = await resolveNaverPlaceId(update.naverPlaceUrl.trim());
    if (newPlaceId) {
      const current = await db.collection("companies").doc(companyCode).collection("restaurants").doc(restaurantId).get();
      if (current.data()?.naverPlaceId !== newPlaceId) {
        extra.naverPlaceId = newPlaceId;
        extra.naverMatchStatus = "manual";
        extra.naverMatchReason = "관리자가 네이버 지도 링크를 지정";
        extra.naverMatchCheckedAt = new Date().toISOString();
      }
    }
  }

  let restaurant = await updateRestaurantAdminFields(companyCode, restaurantId, update, extra);

  // 관리자가 네이버지도 링크(naverPlaceUrl)를 수동으로 입력하거나 수정한 경우
  // 해당 링크의 placeId를 추출하여 전화번호, 영업시간, 메뉴, 제로페이 여부 등을 자동으로 불러와 반영한다.
  if (update.naverPlaceUrl && update.naverPlaceUrl.trim()) {
    try {
      const { enrichRestaurantById } = await import("@/lib/enrich-server");
      const enriched = await enrichRestaurantById(companyCode, restaurantId);
      restaurant = enriched.restaurant;
    } catch (enrichErr) {
      console.warn(`[admin/restaurants PATCH] naverPlaceUrl 수동 입력 수집 실패:`, enrichErr);
    }
  }

  return NextResponse.json({ restaurant });
}
