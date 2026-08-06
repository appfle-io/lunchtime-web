import { db } from "@/lib/firebase";

// 2026-08-06 신규: 알림함(종 아이콘). 친구 추가 알림 + 점심투표 생성 알림이 같은 서브컬렉션을 쓴다.
// companies/{code}/users/{nicknameId}/notifications/{notificationId}
export type NotificationType = "friendAdded" | "voteCreated";

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
