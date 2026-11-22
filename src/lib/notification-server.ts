import { db } from "@/lib/firebase";

// 2026-08-06 신규: 알림함(종 아이콘). 친구 추가 알림 + 점심투표 생성 알림이 같은 서브컬렉션을 쓴다.
// companies/{code}/users/{nicknameId}/notifications/{notificationId}
// 2026-08-09 추가: 가맹점 정보 수정요청 관련 알림 2종 - editRequestCreated(관리자에게: 새 요청이
// 들어왔다), editRequestResolved(요청자에게: 내 요청이 처리됐다).
export type NotificationType =
  | "friendAdded"
  | "voteCreated"
  | "editRequestCreated"
  | "editRequestResolved";

export interface NotificationEntry {
  id: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
  // type === "friendAdded"
  fromNicknameId?: string;
  fromNickname?: string;
  // type === "voteCreated"
  voteId?: string;
  voteTitle?: string;
  creatorNickname?: string;
  // type === "editRequestCreated" | "editRequestResolved"
  restaurantId?: string;
  restaurantName?: string;
  requestSummary?: string; // 요청 유형/내용 한 줄 요약 (restaurant-edit-request.ts의 summarizeEditRequest 결과)
  requesterNickname?: string; // editRequestCreated에서 "누가 요청했는지" 표시용
  requestStatus?: "resolved" | "rejected"; // editRequestResolved에서 처리 결과
}

function notificationsRef(companyCode: string, nicknameId: string) {
  return db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .collection("notifications");
}

export async function listNotifications(
  companyCode: string,
  nicknameId: string
): Promise<NotificationEntry[]> {
  // 예전엔 알림 전체를 읽고 메모리에서 최근 50개만 잘랐다 - 알림은 지우지 않으면 계속 쌓이므로
  // 알림함을 열 때마다 읽기 비용이 계속 늘어나는 구조였다. 서버에서 최신순 50개만 읽는다
  // (단일 필드 정렬이라 별도 색인 불필요).
  const snapshot = await notificationsRef(companyCode, nicknameId)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<NotificationEntry, "id">) }));
}

export async function createNotification(
  companyCode: string,
  nicknameId: string,
  data: Omit<NotificationEntry, "id" | "read" | "createdAt">
): Promise<void> {
  await notificationsRef(companyCode, nicknameId).add({
    ...data,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

export async function markNotificationRead(
  companyCode: string,
  nicknameId: string,
  notificationId: string
): Promise<void> {
  await notificationsRef(companyCode, nicknameId).doc(notificationId).set({ read: true }, { merge: true });
}

export async function deleteNotification(
  companyCode: string,
  nicknameId: string,
  notificationId: string
): Promise<void> {
  await notificationsRef(companyCode, nicknameId).doc(notificationId).delete();
}

export async function getNotification(
  companyCode: string,
  nicknameId: string,
  notificationId: string
): Promise<NotificationEntry | null> {
  const doc = await notificationsRef(companyCode, nicknameId).doc(notificationId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<NotificationEntry, "id">) };
}
