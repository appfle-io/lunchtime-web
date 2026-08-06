import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { setFavorite } from "@/lib/favorite-server";

// POST /api/favorites
// body: { companyCode, restaurantId, isFavorite }
// 로그인한 본인 것만 바꿀 수 있어야 하므로, 클라이언트가 보낸 값이 아니라 세션에서 꺼낸
// nicknameId를 그대로 쓴다 (다른 사람 즐겨찾기를 대신 건드리지 못하게).
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; restaurantId?: string; isFavorite?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId, isFavorite } = body;
  if (!companyCode || !restaurantId || typeof isFavorite !== "boolean") {
    return NextResponse.json(
      { error: "companyCode, restaurantId, isFavorite가 필요합니다." },
      { status: 400 }
    );
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  await setFavorite(companyCode, session.nicknameId, restaurantId, isFavorite);
  return NextResponse.json({ status: "ok", isFavorite });
}
