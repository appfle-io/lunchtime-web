import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import {
  createEditRequest,
  listEditRequestsForRestaurant,
} from "@/lib/restaurant-edit-request-server";
import { listAdminNicknameIds } from "@/lib/admin-server";
import { createNotification } from "@/lib/notification-server";
import {
  EDIT_REQUEST_TYPES,
  EDIT_REQUEST_REQUIRES_VALUE,
  summarizeEditRequest,
  type EditRequestType,
  type EditRequestPayload,
} from "@/lib/restaurant-edit-request";

// GET /api/edit-requests?companyCode=&restaurantId=
// 그 식당에 걸린 수정요청 전체(최신순) - 상세모달에 "내가 보낸 요청" 상태를 보여주는 용도라
// 로그인 여부와 무관하게 그 식당의 요청 목록 자체는 공개한다(요청자 닉네임은 어차피 다른
// 기능에서도 서로 볼 수 있는 정보라 별도 비공개 처리는 안 함).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyCode = searchParams.get("companyCode");
  const restaurantId = searchParams.get("restaurantId");

  if (!companyCode || !restaurantId) {
    return NextResponse.json(
      { error: "companyCode, restaurantId가 필요합니다." },
      { status: 400 }
    );
  }

  const requests = await listEditRequestsForRestaurant(companyCode, restaurantId);
  return NextResponse.json({ requests });
}

// POST /api/edit-requests
// body: { companyCode, restaurantId, restaurantName, type, payload }
// 가맹점 정보 수정요청 제출. 로그인 세션이 필요하다(누가 보냈는지 남겨야 관리자가 확인 가능).
export async function POST(request: NextRequest) {
  let body: {
    companyCode?: string;
    restaurantId?: string;
    restaurantName?: string;
    type?: string;
    payload?: EditRequestPayload;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, restaurantId, restaurantName, type, payload } = body;
  if (!companyCode || !restaurantId || !restaurantName || !type) {
    return NextResponse.json(
      { error: "companyCode, restaurantId, restaurantName, type이 필요합니다." },
      { status: 400 }
    );
  }
  if (!EDIT_REQUEST_TYPES.includes(type as EditRequestType)) {
    return NextResponse.json({ error: "올바르지 않은 요청 유형입니다." }, { status: 400 });
  }
  const requestType = type as EditRequestType;

  // 유형별로 값이 필수인 경우 서버에서도 한 번 더 확인 (클라이언트 검증만 믿지 않음).
  const p = payload ?? {};
  if (EDIT_REQUEST_REQUIRES_VALUE[requestType]) {
    const hasValue =
      Boolean(p.phone) ||
      Boolean(p.businessHours) ||
      Boolean(p.categoryLabel) ||
      Boolean(p.menuName) ||
      typeof p.isZeroPay === "boolean";
    if (!hasValue) {
      return NextResponse.json({ error: "이 유형에는 입력값이 필요합니다." }, { status: 400 });
    }
  }

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const created = await createEditRequest(
    companyCode,
    restaurantId,
    restaurantName,
    session.nicknameId,
    session.nickname,
    requestType,
    p
  );

  // 회사의 모든 관리자에게 알림 - 관리자가 아직 한 명도 없으면(isAdmin 설정 전) 조용히 스킵된다.
  try {
    const adminIds = await listAdminNicknameIds(companyCode);
    await Promise.all(
      adminIds.map((adminNicknameId) =>
        createNotification(companyCode, adminNicknameId, {
          type: "editRequestCreated",
          restaurantId,
          restaurantName,
          requestSummary: summarizeEditRequest(requestType, p),
          requesterNickname: session.nickname,
        })
      )
    );
  } catch {
    // 알림 발송 실패는 요청 저장 자체를 막지 않는다 - 부가 기능이라 조용히 무시.
  }

  return NextResponse.json({ request: created });
}
