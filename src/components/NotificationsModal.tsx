"use client";

import { useState, useMemo, useEffect } from "react";
import { useModalBehavior } from "@/hooks/useModalBehavior";

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
  onDeleteNotification?: (notificationId: string) => void;
  onAddBack: (nickname: string) => void;
  onOpenVote: (voteId: string) => void;
}

const ITEMS_PER_PAGE = 5;

export default function NotificationsModal({
  open,
  notifications,
  onClose,
  onMarkRead,
  onDeleteNotification,
  onAddBack,
  onOpenVote,
}: NotificationsModalProps) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(notifications.length / ITEMS_PER_PAGE));

  // 알림 개수 변경 시 현재 페이지 보정
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [notifications.length, totalPages, currentPage]);

  const pagedNotifications = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return notifications.slice(start, start + ITEMS_PER_PAGE);
  }, [notifications, currentPage]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  useModalBehavior(open, onClose);

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
        className="flex max-h-[85vh] w-full max-w-md flex-col justify-between rounded-2xl bg-surface p-5 shadow-soft border border-black/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-black/5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-ink">알림</h3>
            {notifications.length > 0 && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft font-semibold">
                총 {notifications.length}개
                {unreadCount > 0 && ` (안 읽음 ${unreadCount})`}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-xl p-1.5 text-ink-soft transition hover:bg-surface-muted hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 알림 목록 본문 */}
        <div className="flex-1 overflow-y-auto py-3 min-h-[220px]">
          {notifications.length === 0 ? (
            <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-ink-soft">
              아직 알림이 없습니다.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {pagedNotifications.map((n) => {
                const textClass = n.read ? "text-gray-400" : "text-ink font-medium";
                return (
                  <li
                    key={n.id}
                    onClick={() => !n.read && onMarkRead(n.id)}
                    className="relative group cursor-pointer rounded-xl border border-black/5 bg-surface p-3 transition hover:border-primary/30 hover:bg-surface-muted/30 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2 pr-6">
                      <div className="min-w-0 flex-1">
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
                        <p className="mt-1 text-xs text-ink-soft">{formatRelativeTime(n.createdAt)}</p>
                      </div>
                    </div>

                    {/* 우측 상단 개별 알림 삭제 버튼 */}
                    {onDeleteNotification && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNotification(n.id);
                        }}
                        className="absolute right-2.5 top-2.5 rounded-lg p-1 text-ink-soft hover:bg-surface-muted hover:text-rose-600 transition"
                        title="알림 삭제"
                        aria-label="알림 삭제"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 하단 페이지네이션 바 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 border-t border-black/5 pt-3 shrink-0">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent"
            >
              이전
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`h-7 w-7 rounded-lg text-xs font-bold transition ${
                  currentPage === pageNum
                    ? "bg-primary text-white shadow-xs"
                    : "border border-black/5 bg-surface text-ink-soft hover:bg-surface-muted"
                }`}
              >
                {pageNum}
              </button>
            ))}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-muted disabled:opacity-30 disabled:hover:bg-transparent"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
