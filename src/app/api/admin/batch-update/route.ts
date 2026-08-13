import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { invalidateRestaurantsCache } from "@/lib/restaurant-server";

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

export interface BatchUpdateItem {
  id: string;
  patch: Record<string, any>;
}

export async function POST(request: NextRequest) {
  let body: { companyCode?: string; items?: BatchUpdateItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, items } = body;
  if (!companyCode || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "companyCode 및 선택된 업데이트 항목(items)이 필요합니다." }, { status: 400 });
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  try {
    const restaurantsRef = db.collection("companies").doc(companyCode).collection("restaurants");
    const WRITE_BATCH = 400;
    let updatedCount = 0;

    for (let i = 0; i < items.length; i += WRITE_BATCH) {
      const batch = db.batch();
      const chunk = items.slice(i, i + WRITE_BATCH);

      for (const item of chunk) {
        if (!item.id || !item.patch) continue;
        batch.update(restaurantsRef.doc(item.id), item.patch);
        updatedCount++;
      }

      await batch.commit();
    }

    // 지도/목록 갱신용 메모리 캐시 무효화
    invalidateRestaurantsCache(companyCode);

    return NextResponse.json({ success: true, updatedCount });
  } catch (err) {
    console.error("[admin/batch-update] 일괄 업데이트 실패:", err);
    return NextResponse.json({ error: "일괄 업데이트 적용 중 오류가 발생했습니다." }, { status: 500 });
  }
}
