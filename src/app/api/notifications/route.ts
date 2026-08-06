import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { listNotifications, markNotificationRead } from "@/lib/notification-server";

function getSession(request: NextRequest, companyCode: string | null) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || !companyCode || session.companyCode !== companyCode) return null;
  return session;
}

// GET /api/notifications?companyCode= - 내 알림함 조회 (최신순 최대 50개).
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  const session = getSession(request, companyCode);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const notifications = await listNotifications(companyCode, session.nicknameId);
  return NextResponse.json({ notifications });
}

// POST /api/notifications - body: { companyCode, notificationId } - 읽음 처리(회색 글씨로 전환용).
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; notificationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, notificationId } = body;
  const session = getSession(request, companyCode ?? null);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!notificationId) {
    return NextResponse.json({ error: "notificationId가 필요합니다." }, { status: 400 });
  }

  await markNotificationRead(companyCode, session.nicknameId, notificationId);
  return NextResponse.json({ status: "ok" });
}
