import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import {
  listMealLogsForMonth,
  listMealLogsForDate,
  addMealLog,
  updateMealLog,
  deleteMealLog,
} from "@/lib/meal-log-server";

// 밥 먹은 기록(캘린더뷰)은 전부 "내 것"만 다루므로, 요청 본문/쿼리의 nicknameId가 아니라
// 항상 세션에서 꺼낸 nicknameId를 쓴다 (favorites/reviews API와 동일한 패턴).
function requireSession(companyCode: string | null) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || !companyCode || session.companyCode !== companyCode) return null;
  return session;
}

// GET /api/meal-logs?companyCode=&month=YYYY-MM   -> 그 달 전체 기록 (캘린더뷰용, 하루에 여러 건 가능)
// GET /api/meal-logs?companyCode=&date=YYYY-MM-DD -> 특정 날짜 기록 전체 (식당 상세모달의
//   "오늘 여기서 먹었어요" 버튼이 오늘 이미 뭘 기록했는지 보여줄 때 씀)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyCode = searchParams.get("companyCode");
  const month = searchParams.get("month");
  const date = searchParams.get("date");

  const session = requireSession(companyCode);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  if (date) {
    const logs = await listMealLogsForDate(companyCode!, session.nicknameId, date);
    return NextResponse.json({ logs });
  }

  if (!month) {
    return NextResponse.json({ error: "month 또는 date가 필요합니다." }, { status: 400 });
  }

  const logs = await listMealLogsForMonth(companyCode!, session.nicknameId, month);
  return NextResponse.json({ logs });
}

// POST /api/meal-logs - 새 기록 추가 (하루에 여러 번 호출하면 각각 별도 건으로 쌓인다 - 회식 등
// 하루 여러 끼 기록 대응)
// body: { companyCode, date, restaurantId?, restaurantName, category?, memo? }
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    date?: string;
    restaurantId?: string | null;
    restaurantName?: string;
    category?: string | null;
    memo?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, date, restaurantName } = body;
  if (!companyCode || !date || !restaurantName?.trim()) {
    return NextResponse.json(
      { error: "companyCode, date, restaurantName이 필요합니다." },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date 형식이 올바르지 않습니다 (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  const session = requireSession(companyCode);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const log = await addMealLog(companyCode, session.nicknameId, {
    date,
    restaurantId: body.restaurantId ?? null,
    restaurantName: restaurantName.trim(),
    category: body.category ?? null,
    memo: body.memo?.trim() ?? "",
  });
  return NextResponse.json({ log });
}

// PATCH /api/meal-logs - 기존 기록 한 건 수정 (캘린더뷰에서 날짜의 특정 기록을 고칠 때)
// body: { companyCode, id, restaurantId?, restaurantName?, category?, memo? }
export async function PATCH(request: NextRequest) {
  let body: {
    companyCode?: string;
    id?: string;
    restaurantId?: string | null;
    restaurantName?: string;
    category?: string | null;
    memo?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, id } = body;
  if (!companyCode || !id) {
    return NextResponse.json({ error: "companyCode, id가 필요합니다." }, { status: 400 });
  }

  const session = requireSession(companyCode);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  await updateMealLog(companyCode, session.nicknameId, id, {
    restaurantId: body.restaurantId,
    restaurantName: body.restaurantName?.trim(),
    category: body.category,
    memo: body.memo?.trim(),
  });
  return NextResponse.json({ status: "ok" });
}

// DELETE /api/meal-logs - 기록 한 건 삭제
// body: { companyCode, id }
export async function DELETE(request: NextRequest) {
  let body: { companyCode?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, id } = body;
  if (!companyCode || !id) {
    return NextResponse.json({ error: "companyCode, id가 필요합니다." }, { status: 400 });
  }

  const session = requireSession(companyCode);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  await deleteMealLog(companyCode, session.nicknameId, id);
  return NextResponse.json({ status: "ok" });
}
