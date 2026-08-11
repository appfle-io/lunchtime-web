import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { enrichRestaurantById } from "@/lib/enrich-server";

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

// POST /api/admin/restaurants/enrich
// 관리자 전용: 특정 가맹점의 제로페이 및 네이버맵 상세 정보를 수동(수기)으로 불러와 DB에 저장한다.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; restaurantId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId } = body;
  if (!companyCode || !restaurantId) {
    return NextResponse.json(
      { error: "companyCode와 restaurantId가 필요합니다." },
      { status: 400 }
    );
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  try {
    const result = await enrichRestaurantById(companyCode, restaurantId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message ?? "정보 수집에 실패했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
