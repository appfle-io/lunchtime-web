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
  // orderBy 없이 전체(최대 50개 최근 것만 남기고 싶지만 지금은 다 읽어 메모리 정렬 - 토이 프로젝트
  // 규모라 문제 없음)를 읽어서 최신순으로 정렬한다.
  const snapshot = await notificationsRef(companyCode, nicknameId).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<NotificationEntry, "id">) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50);
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

export async function getNotification(
  companyCode: string,
  nicknameId: string,
  notificationId: string
): Promise<NotificationEntry | null> {
  const doc = await notificationsRef(companyCode, nicknameId).doc(notificationId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<NotificationEntry, "id">) };
}
