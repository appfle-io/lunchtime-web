"use client";

export interface NotificationEntry {
  id: string;
  type: "friendAdded" | "voteCreated" | "editRequestCreated" | "editRequestResolved";
  read: boolean;
  createdAt: string;
  fromNicknameId?: string;
  fromNickname?: string;
  voteId?: string;
  voteTitle?: string;
  creatorNickname?: string;
  // 2026-08-09 신규: 가맹점 정보 수정요청 관련 알림 필드.
  restaurantId?: string;
  restaurantName?: string;
  requestSummary?: string;
  requesterNickname?: string;
  requestStatus?: "resolved" | "rejected";
}

interface NotificationsModalProps {
  open: boolean;
  notifications: NotificationEntry[];
  onClose: () => void;
  onMarkRead: (notificationId: string) => void;
  onAddBack: (nickname: string) => void; // "나도 추가하기" - FriendsModal을 그 닉네임으로 미리 채워서 연다
  onOpenVote: (voteId: string) => void; // "투표하러 가기" - LunchVoteModal을 해당 투표로 연다
}

// 2026-08-06 신규: 알림함(종 아이콘) 모달. 읽지 않은 알림은 진하게, 읽은 알림은 회색으로 표시한다
// (사용자 요청: "알림은 한번 읽으면 회색 글씨체로 변경"). 알림 행을 누르면 읽음 처리되고, friendAdded
// 타입은 "나도 추가하기" 버튼으로 바로 맞추어 추가할 수 있게 한다.
// 2026-08-09 추가: editRequestCreated(관리자에게: 새 수정요청이 들어왔다) / editRequestResolved
// (요청자에게: 내 요청이 처리됐다) 두 타입을 새로 처리한다. 이동 액션은 아직 안 붙였다 - 관리자
// 페이지가 만들어지면 그때 "확인하러 가기" 버튼을 여기 추가할 예정.
export default function NotificationsModal({
  open,
  notifications,
  onClose,
  onMarkRead,
  onAddBack,
  onOpenVote,
}: NotificationsModalProps) {
  if (!open) return null;

  function formatRelativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-2 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">🔔 알림</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        {notifications.length === 0 && (
          <p className="py-4 text-center text-sm text-ink-soft">아직 알림이 없어요.</p>
        )}

        <ul className="flex flex-col gap-1.5">
          {notifications.map((n) => {
            const textClass = n.read ? "text-gray-400" : "text-ink font-medium";
            return (
              <li
                key={n.id}
                onClick={() => !n.read && onMarkRead(n.id)}
                className="cursor-pointer rounded-xl border border-black/5 p-3 transition hover:border-primary/30"
              >
                {n.type === "friendAdded" && (
                  <>
                    <p className={`text-sm ${textClass}`}>
                      <span className="font-semibold">{n.fromNickname}</span>님이 친구로
                      추가했습니다.
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                        onAddBack(n.fromNickname ?? "");
                      }}
                      className="mt-1.5 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary-dark transition hover:bg-primary-light/70"
                    >
                      나도 추가하기
                    </button>
                  </>
                )}
                {n.type === "voteCreated" && (
                  <>
                    <p className={`text-sm ${textClass}`}>
                      <span className="font-semibold">{n.creatorNickname}</span>님이 &ldquo;
                      {n.voteTitle}&rdquo; 투표를 만들었어요.
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                        if (n.voteId) onOpenVote(n.voteId);
                      }}
                      className="mt-1.5 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary-dark transition hover:bg-primary-light/70"
                    >
                      투표하러 가기
                    </button>
                  </>
                )}
                {n.type === "editRequestCreated" && (
                  <p className={`text-sm ${textClass}`}>
                    <span className="font-semibold">{n.requesterNickname}</span>님이{" "}
                    <span className="font-semibold">{n.restaurantName}</span>에 정보 수정을
                    요청했어요.
                    {n.requestSummary && (
                      <span className="mt-0.5 block text-xs text-ink-soft">{n.requestSummary}</span>
                    )}
                  </p>
                )}
                {n.type === "editRequestResolved" && (
                  <p className={`text-sm ${textClass}`}>
                    <span className="font-semibold">{n.restaurantName}</span> 수정 요청이{" "}
                    {n.requestStatus === "rejected" ? "거절됐어요." : "처리됐어요."}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-soft">{formatRelativeTime(n.createdAt)}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
