import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
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

  const restaurant = await updateRestaurantAdminFields(companyCode, restaurantId, update);
  return NextResponse.json({ restaurant });
}
