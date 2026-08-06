"use client";

import { useEffect, useState } from "react";
import type { RestaurantSummary, ReviewSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";
import type { ZeroPayStatus } from "@/lib/zeropay-server";

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
}

// 마커 클릭 / 리스트 클릭으로 열리는 식당 상세 모달. 댓글과 제로페이 투표 현황은 열릴 때마다
// 서버에서 새로 불러온다.
export default function RestaurantDetail({
  restaurant,
  companyCode,
  nickname,
  isFavorite,
  onToggleFavorite,
  onClose,
  onZeroPayStatusChange,
}: RestaurantDetailProps) {
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [zeroPayStatus, setZeroPayStatus] = useState<ZeroPayStatus | null>(null);
  const [voting, setVoting] = useState(false);

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
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs",
              effectiveIsZeroPay
                ? "bg-primary-light text-primary-dark"
                : "bg-surface-muted text-ink-soft",
            ].join(" ")}
          >
            {effectiveIsZeroPay ? "제로페이 가능" : "제로페이 미확인"}
          </span>
          {needsReview && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              ⚠️ 확인 필요 (최근 거꾸로엄지척 다수)
            </span>
          )}
        </div>

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
