"use client";

import { useEffect, useState } from "react";
import type { RestaurantSummary, ReviewSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";
import type { ZeroPayStatus } from "@/lib/zeropay-server";
import type { MealLogEntry } from "@/lib/meal-log-server";

function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface RestaurantDetailProps {
  restaurant: RestaurantSummary | null;
  companyCode: string;
  nickname: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  // 2026-08-06 신규: 투표 결과로 이 식당의 isZeroPay/isZeroPayNeedsReview가 바뀌었을 수 있으니,
  // 상위(CompanyHome)가 restaurants 목록도 같이 갱신할 수 있게 알려준다 (지도 배지/리스트 배지 동기화용).
  onZeroPayStatusChange?: (restaurantId: string, status: ZeroPayStatus) => void;
  // 2026-08-06 저녁 신규: 토스트 알림용.
  onNotify?: (message: string) => void;
  // 2026-08-06 저녁 신규: "오늘 여기서 먹었어요" 버튼으로 기록을 추가/삭제하면, 지금 화면에 떠 있는
  // 캘린더뷰(주변식당 목록 아래)도 다시 불러오게 CompanyHome에 신호를 보낸다 (MapView의 homeSignal과
  // 같은 "카운터를 신호로 쓰는" 패턴).
  onMealLogged?: () => void;
}

// 마커 클릭 / 리스트 클릭으로 열리는 식당 상세 모달. 댓글과 제로페이 투표 현황, 오늘 이 식당을
// 밥 먹은 기록으로 남겼는지는 열릴 때마다 서버에서 새로 불러온다.
export default function RestaurantDetail({
  restaurant,
  companyCode,
  nickname,
  isFavorite,
  onToggleFavorite,
  onClose,
  onZeroPayStatusChange,
  onNotify,
  onMealLogged,
}: RestaurantDetailProps) {
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [zeroPayStatus, setZeroPayStatus] = useState<ZeroPayStatus | null>(null);
  const [voting, setVoting] = useState(false);

  // 2026-08-06 저녁 신규: 오늘 밥 먹은 기록 목록. 하루에 여러 건(회식 등) 가능해서 배열로 관리한다.
  // null이면 아직 로딩 전.
  const [todayLogs, setTodayLogs] = useState<MealLogEntry[] | null>(null);
  const [loggingMeal, setLoggingMeal] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    setReviews([]);
    setLoadError(null);
    setLoading(true);

    fetch(
      `/api/reviews?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
    )
      .then((res) => res.json())
      .then((data) => setReviews(data.reviews ?? []))
      .catch(() => setLoadError("댓글을 불러오지 못했어요."))
      .finally(() => setLoading(false));

    setZeroPayStatus(null);
    fetch(
      `/api/zeropay-votes?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
    )
      .then((res) => res.json())
      .then((data) => setZeroPayStatus(data))
      .catch(() => {
        // 투표 현황은 부가 정보라 실패해도 조용히 무시 - 기존 isZeroPay 배지만 보여준다.
      });

    setTodayLogs(null);
    fetch(`/api/meal-logs?companyCode=${encodeURIComponent(companyCode)}&date=${todayDateKey()}`)
      .then((res) => res.json())
      .then((data) => setTodayLogs((data.logs ?? []) as MealLogEntry[]))
      .catch(() => setTodayLogs([]));
  }, [restaurant, companyCode]);

  if (!restaurant) return null;

  const visual = getCategoryVisual(restaurant.category);

  async function handleVote(vote: "up" | "down") {
    if (!restaurant || voting) return;
    setVoting(true);
    try {
      const res = await fetch("/api/zeropay-votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, restaurantId: restaurant.id, vote }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as ZeroPayStatus;
      setZeroPayStatus(data);
      onZeroPayStatusChange?.(restaurant.id, data);
    } catch {
      // 네트워크 오류 시 조용히 무시 - 다시 눌러보게 둔다.
    } finally {
      setVoting(false);
    }
  }

  // "오늘 여기서 먹었어요" - 오늘 날짜 기록을 새로 추가한다. 하루에 여러 건(회식 등)이 가능해서
  // 이미 오늘 기록이 있어도 버튼은 계속 눌러서 추가할 수 있다 - 캘린더뷰(MealLogCalendar)의
  // 날짜별 기록 추가와 같은 API를 쓴다.
  async function handleLogMealToday() {
    if (!restaurant || loggingMeal) return;
    setLoggingMeal(true);
    try {
      const res = await fetch("/api/meal-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          date: todayDateKey(),
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          category: restaurant.category ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "기록을 남기지 못했어요.");
        return;
      }
      setTodayLogs((prev) => [...(prev ?? []), data.log as MealLogEntry]);
      onNotify?.("오늘 여기서 먹었다고 기록했어요.");
      onMealLogged?.();
    } catch {
      onNotify?.("네트워크 오류로 기록을 남기지 못했어요.");
    } finally {
      setLoggingMeal(false);
    }
  }

  async function handleRemoveTodayLog(id: string) {
    setDeletingLogId(id);
    try {
      const res = await fetch("/api/meal-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, id }),
      });
      if (!res.ok) {
        onNotify?.("기록을 삭제하지 못했어요.");
        return;
      }
      setTodayLogs((prev) => (prev ?? []).filter((e) => e.id !== id));
      onMealLogged?.();
    } catch {
      onNotify?.("네트워크 오류로 삭제하지 못했어요.");
    } finally {
      setDeletingLogId(null);
    }
  }

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          restaurantId: restaurant.id,
          content: commentText.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error ?? "댓글을 남기지 못했어요.");
        return;
      }

      setReviews((prev) => [data.review, ...prev]);
      setCommentText("");
    } catch {
      setSubmitError("네트워크 오류로 댓글을 남기지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  // isZeroPay 배지는 서버가 내려준 restaurant.isZeroPay(캐시된 값)로 먼저 보여주고,
  // 상세 투표 현황(zeroPayStatus)이 로드되면 그걸로 최신화한다.
  const effectiveIsZeroPay = zeroPayStatus ? zeroPayStatus.effectiveIsZeroPay : restaurant.isZeroPay;
  const needsReview = zeroPayStatus ? zeroPayStatus.needsReview : restaurant.isZeroPayNeedsReview;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl2 bg-surface p-6 shadow-soft"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">{visual.emoji}</span>
              <h2 className="text-lg font-bold text-ink">{restaurant.name}</h2>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{restaurant.address}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onToggleFavorite}
              aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              className="rounded-full p-1 text-lg leading-none transition hover:bg-surface-muted"
            >
              {isFavorite ? "❤️" : "🤍"}
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
            {visual.label}
          </span>
          {typeof restaurant.distanceMeters === "number" && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
              {restaurant.distanceMeters}m
            </span>
          )}
          {/* 2026-08-07: "제로페이 미확인" 배지를 없앴다 - 확인이 안 된 상태를 미리 단정짓지 않고,
              아래 엄지척/거꾸로엄지척 투표로 사용자들이 직접 판단하도록 열어둔다. 확인된(가능한)
              경우에만 배지를 보여준다. */}
          {effectiveIsZeroPay && (
            <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary-dark">
              제로페이 가능
            </span>
          )}
          {needsReview && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              ⚠️ 확인 필요 (최근 거꾸로엄지척 다수)
            </span>
          )}
        </div>

        {/* 2026-08-06 저녁 신규: "오늘 여기서 먹었어요" - 밥 먹은 기록(캘린더뷰)에 오늘 날짜로
            새 기록을 추가한다. 하루에 여러 건(회식 등) 가능해서 이미 기록이 있어도 계속 추가할
            수 있고, 오늘 이미 남긴 기록은 아래 칩으로 보여주고 바로 지울 수도 있다. */}
        <button
          onClick={handleLogMealToday}
          disabled={loggingMeal}
          className="mt-3 w-full rounded-xl2 bg-surface-muted px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-primary-light hover:text-primary-dark disabled:opacity-70"
        >
          {loggingMeal ? "기록하는 중..." : "오늘 여기서 먹었어요"}
        </button>

        {todayLogs && todayLogs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {todayLogs.map((log) => (
              <span
                key={log.id}
                className="flex items-center gap-1 rounded-full bg-primary-light px-2.5 py-1 text-xs text-primary-dark"
              >
                ✅ {log.restaurantName}
                <button
                  onClick={() => handleRemoveTodayLog(log.id)}
                  disabled={deletingLogId === log.id}
                  aria-label="오늘 기록 삭제"
                  className="text-primary-dark/70 hover:text-primary-dark"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 2026-08-06 신규: 제로페이 엄지척/거꾸로엄지척 투표. "됨" 표시가 있어도 최근 거꾸로엄지척이
            많아지면 needsReview 배지가 뜨니, 이 버튼들로 계속 최신 상태를 유지해간다. */}
        <div className="mt-3 flex items-center gap-2 rounded-xl2 bg-surface-muted p-3">
          <p className="flex-1 text-xs text-ink-soft">여기 제로페이(비플식권) 되나요?</p>
          <button
            onClick={() => handleVote("up")}
            disabled={voting}
            aria-label="제로페이 됨 (엄지척)"
            className={[
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium transition disabled:opacity-60",
              zeroPayStatus?.myVote === "up"
                ? "bg-primary text-white"
                : "bg-surface text-ink-soft hover:bg-primary-light",
            ].join(" ")}
          >
            👍 {zeroPayStatus?.upCount ?? 0}
          </button>
          <button
            onClick={() => handleVote("down")}
            disabled={voting}
            aria-label="제로페이 안 됨 (거꾸로엄지척)"
            className={[
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium transition disabled:opacity-60",
              zeroPayStatus?.myVote === "down"
                ? "bg-ink text-white"
                : "bg-surface text-ink-soft hover:bg-surface-muted",
            ].join(" ")}
          >
            👎 {zeroPayStatus?.downCount ?? 0}
          </button>
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">댓글</h3>

          {loading && <p className="text-sm text-ink-soft">불러오는 중...</p>}
          {loadError && <p className="text-sm text-primary-dark">{loadError}</p>}
          {!loading && !loadError && reviews.length === 0 && (
            <p className="text-sm text-ink-soft">아직 댓글이 없어요. 첫 댓글을 남겨볼까요?</p>
          )}

          <ul className="flex flex-col gap-2">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-xl2 bg-surface-muted p-3">
                <p className="text-sm text-ink">{review.content}</p>
                <p className="mt-1 text-xs text-ink-soft">{review.authorNickname}</p>
              </li>
            ))}
          </ul>

          <form onSubmit={handleSubmitComment} className="mt-3 flex flex-col gap-2">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={`${nickname}님, 댓글을 남겨보세요`}
              rows={2}
              className="rounded-xl2 border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {submitError && <p className="text-xs text-primary-dark">{submitError}</p>}
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="self-end rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {submitting ? "등록 중..." : "댓글 등록"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
