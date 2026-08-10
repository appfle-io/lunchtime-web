import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import {
  listPendingEditRequests,
  getEditRequest,
  resolveEditRequest,
} from "@/lib/restaurant-edit-request-server";
import { createNotification } from "@/lib/notification-server";

// 관리자 API는 페이지 가드(admin/page.tsx)와 별개로 라우트 자체에서도 세션+isAdmin을 확인한다 -
// API는 URL을 직접 알면 페이지를 거치지 않고도 호출할 수 있어서, 페이지 가드만 믿으면 안 된다.
async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

// GET /api/admin/edit-requests?companyCode=
// 그 회사의 대기중인 수정요청 전체(최신순).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyCode = searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const requests = await listPendingEditRequests(companyCode);
  return NextResponse.json({ requests });
}

// POST /api/admin/edit-requests
// body: { companyCode, requestId, action: "resolve" | "reject", adminNote? }
// 요청을 승인/거절 처리하고 요청자에게 알림을 보낸다. 실제 가맹점 데이터 반영은 관리자가 이
// 값을 보고 별도로 /api/admin/restaurants PATCH로 직접 편집한 뒤 이걸 호출하는 흐름을 기대한다
// (요청 payload를 자동으로 믿고 필드에 덮어쓰지는 않음 - 관리자가 값을 확인하고 판단하게 한다).
// 2026-08-09: editRequests가 식당 하위 서브컬렉션에서 회사 최상위 평평한 컬렉션으로 바뀌면서
// restaurantId 없이도 requestId 하나로 문서를 바로 찾을 수 있게 됐다.
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    requestId?: string;
    action?: string;
    adminNote?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, requestId, action, adminNote } = body;
  if (!companyCode || !requestId || (action !== "resolve" && action !== "reject")) {
    return NextResponse.json(
      { error: "companyCode, requestId, action(resolve/reject)이 필요합니다." },
      { status: 400 }
    );
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  // 알림에 쓸 요청자 정보를 status를 바꾸기 전에 먼저 조회해둔다.
  const original = await getEditRequest(companyCode, requestId);
  if (!original) {
    return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  }

  const status = action === "resolve" ? "resolved" : "rejected";
  await resolveEditRequest(companyCode, requestId, status, session.nickname, adminNote);

  try {
    await createNotification(companyCode, original.requestedByNicknameId, {
      type: "editRequestResolved",
      restaurantId: original.restaurantId,
      restaurantName: original.restaurantName,
      requestStatus: status,
    });
  } catch {
    // 알림 발송 실패는 처리 자체를 막지 않는다 - 부가 기능이라 조용히 무시.
  }

  return NextResponse.json({ status: "ok" });
}
