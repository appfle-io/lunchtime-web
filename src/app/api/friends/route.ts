import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { addFriend, listFriends, removeFriend, updateFriendMemo } from "@/lib/friend-server";
import { findUserByNickname } from "@/lib/user-server";
import { createNotification } from "@/lib/notification-server";

function getSession(request: NextRequest, companyCode: string | null) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || !companyCode || session.companyCode !== companyCode) return null;
  return session;
}

// GET /api/friends?companyCode= - 내 친구목록 조회.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  const session = getSession(request, companyCode);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const friends = await listFriends(companyCode, session.nicknameId);
  return NextResponse.json({ friends });
}

// POST /api/friends
// body: { companyCode, friendNickname, memo }
// 단방향 추가 - 상대방 동의 없이 바로 추가되고, 상대방에게는 알림만 하나 남는다.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; friendNickname?: string; memo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, friendNickname, memo } = body;
  const session = getSession(request, companyCode ?? null);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!friendNickname?.trim()) {
    return NextResponse.json({ error: "친구 닉네임이 필요합니다." }, { status: 400 });
  }

  const targetUser = await findUserByNickname(companyCode, friendNickname.trim());
  if (!targetUser) {
    return NextResponse.json({ error: "해당 닉네임을 가진 사용자를 찾지 못했어요." }, { status: 404 });
  }
  if (targetUser.nicknameId === session.nicknameId) {
    return NextResponse.json({ error: "본인은 친구로 추가할 수 없어요." }, { status: 400 });
  }

  const friend = await addFriend(
    companyCode,
    session.nicknameId,
    targetUser.nicknameId,
    targetUser.nickname,
    memo ?? ""
  );

  // 상대방에게 "OOO이 친구로 추가했습니다" 알림을 남긴다. 이미 상대방이 나를 추가해서 아는 사이여도
  // 그냥 다시 알려준다 - 중복 알림보다 "몰랐던 추가를 놓치는 것"이 더 나쁘다고 판단.
  await createNotification(companyCode, targetUser.nicknameId, {
    type: "friendAdded",
    fromNicknameId: session.nicknameId,
    fromNickname: session.nickname,
  });

  return NextResponse.json({ friend });
}

// PATCH /api/friends - 메모 수정. body: { companyCode, friendNicknameId, memo }
export async function PATCH(request: NextRequest) {
  let body: { companyCode?: string; friendNicknameId?: string; memo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, friendNicknameId, memo } = body;
  const session = getSession(request, companyCode ?? null);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!friendNicknameId) {
    return NextResponse.json({ error: "friendNicknameId가 필요합니다." }, { status: 400 });
  }

  await updateFriendMemo(companyCode, session.nicknameId, friendNicknameId, memo ?? "");
  return NextResponse.json({ status: "ok" });
}

// DELETE /api/friends - 친구 삭제. body: { companyCode, friendNicknameId }
export async function DELETE(request: NextRequest) {
  let body: { companyCode?: string; friendNicknameId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, friendNicknameId } = body;
  const session = getSession(request, companyCode ?? null);
  if (!session || !companyCode) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!friendNicknameId) {
    return NextResponse.json({ error: "friendNicknameId가 필요합니다." }, { status: 400 });
  }

  await removeFriend(companyCode, session.nicknameId, friendNicknameId);
  return NextResponse.json({ status: "ok" });
}
