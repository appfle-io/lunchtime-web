"use client";

import { useEffect, useState } from "react";
import type { RestaurantSummary, ReviewSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";
import type { ZeroPayStatus } from "@/lib/zeropay-server";
import type { MealLogEntry } from "@/lib/meal-log-server";
import { toNicknameId } from "@/lib/nickname";
import { EDIT_REQUEST_TYPE_LABELS, summarizeEditRequest } from "@/lib/restaurant-edit-request";
import type { RestaurantEditRequest } from "@/lib/restaurant-edit-request-server";
import EditRequestModal from "./EditRequestModal";
import AdminDirectEditModal from "./AdminDirectEditModal";

function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface DetailCacheEntry {
  reviews: ReviewSummary[];
  zeroPayStatus: ZeroPayStatus | null;
  todayLogs: MealLogEntry[];
  myEditRequests: RestaurantEditRequest[];
  lastActivityAt: string | null;
}

const detailCache = new Map<string, DetailCacheEntry>();

function cacheKeyFor(companyCode: string, restaurantId: string): string {
  return `${companyCode}:${restaurantId}:${todayDateKey()}`;
}

function writeCache(companyCode: string, restaurantId: string, patch: Partial<DetailCacheEntry>) {
  const key = cacheKeyFor(companyCode, restaurantId);
  const existing = detailCache.get(key);
  detailCache.set(key, {
    reviews: existing?.reviews ?? [],
    zeroPayStatus: existing?.zeroPayStatus ?? null,
    todayLogs: existing?.todayLogs ?? [],
    myEditRequests: existing?.myEditRequests ?? [],
    lastActivityAt: existing?.lastActivityAt ?? null,
    ...patch,
  });
}

function formatBusinessHours(raw: unknown): string[] {
  if (!raw) return [];

  let lines: string[] = [];

  if (typeof raw === "string") {
    lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(raw)) {
    lines = raw
      .flatMap((item) => {
        if (typeof item === "string") return item.split("\n");
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const day = (o.day ?? o.dayOfWeek ?? o.label ?? o.name ?? "") as string;
          const time = (o.time ?? o.hours ?? o.businessHours ?? o.timeString ?? "") as string;
          return [day && time ? `${day} ${time}` : day || time];
        }
        return [];
      })
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (typeof raw === "object" && raw !== null) {
    lines = Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => (typeof v === "string" && v ? `${k}: ${v}` : ""))
      .filter(Boolean);
  }

  if (lines.length === 0) return [];

  const parsedDayHours: Array<{ day: string; time: string; original: string }> = [];
  const extraLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([월화수목금토일])(?:요일)?\s*[\:\-\s]?\s*(.+)$/);
    if (match) {
      parsedDayHours.push({
        day: match[1],
        time: match[2].trim().replace(/\s*-\s*/, " ~ "),
        original: line,
      });
    } else {
      extraLines.push(line.startsWith("-") ? line.replace(/^-/, "ℹ️ ").trim() : line);
    }
  }

  if (parsedDayHours.length === 0) {
    return lines;
  }

  const grouped: string[] = [];
  let currentGroup: { startDay: string; endDay: string; time: string } | null = null;

  for (const item of parsedDayHours) {
    if (!currentGroup) {
      currentGroup = { startDay: item.day, endDay: item.day, time: item.time };
    } else if (currentGroup.time === item.time) {
      currentGroup.endDay = item.day;
    } else {
      const dayRange =
        currentGroup.startDay === currentGroup.endDay
          ? currentGroup.startDay
          : `${currentGroup.startDay}~${currentGroup.endDay}`;
      grouped.push(`${dayRange} : ${currentGroup.time}`);
      currentGroup = { startDay: item.day, endDay: item.day, time: item.time };
    }
  }

  if (currentGroup) {
    const dayRange =
      currentGroup.startDay === currentGroup.endDay
        ? currentGroup.startDay
        : `${currentGroup.startDay}~${currentGroup.endDay}`;
    grouped.push(`${dayRange} : ${currentGroup.time}`);
  }

  return [...grouped, ...extraLines];
}

function formatMenuPrice(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const segments = trimmed.split(/([~\-])/);
  const formattedSegments = segments.map((segment) => {
    if (segment === "~" || segment === "-") return segment;
    const digits = segment.replace(/[^0-9]/g, "");
    if (!digits) return segment;
    return Number(digits).toLocaleString("ko-KR");
  });

  const joined = formattedSegments.join("");
  return /원/.test(joined) ? joined : `${joined}원`;
}

interface RestaurantDetailProps {
  restaurant: RestaurantSummary | null;
  companyCode: string;
  nickname: string;
  isAdmin?: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onZeroPayStatusChange?: (restaurantId: string, status: ZeroPayStatus) => void;
  onNotify?: (message: string) => void;
  onMealLogged?: () => void;
  onUpdateRestaurant?: (updated: RestaurantSummary) => void;
}

const MENU_PREVIEW_COUNT = 5;

export default function RestaurantDetail({
  restaurant: initialRestaurant,
  companyCode,
  nickname,
  isAdmin = false,
  isFavorite,
  onToggleFavorite,
  onClose,
  onZeroPayStatusChange,
  onNotify,
  onMealLogged,
  onUpdateRestaurant,
}: RestaurantDetailProps) {
  const [currentRestaurant, setCurrentRestaurant] = useState<RestaurantSummary | null>(initialRestaurant);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [zeroPayStatus, setZeroPayStatus] = useState<ZeroPayStatus | null>(null);
  const [voting, setVoting] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const [todayLogs, setTodayLogs] = useState<MealLogEntry[] | null>(null);
  const [loggingMeal, setLoggingMeal] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  const [showAllMenus, setShowAllMenus] = useState(false);

  const [showEditRequest, setShowEditRequest] = useState(false);
  const [showAdminDirectEdit, setShowAdminDirectEdit] = useState(false);
  const [myEditRequests, setMyEditRequests] = useState<RestaurantEditRequest[]>([]);

  const isAdminUser = Boolean(isAdmin);

  useEffect(() => {
    setCurrentRestaurant(initialRestaurant);
  }, [initialRestaurant]);

  function handleRestaurantUpdated(updated: RestaurantSummary) {
    setCurrentRestaurant(updated);
    onUpdateRestaurant?.(updated);
  }

  async function handleEnrichRestaurant() {
    if (!currentRestaurant || enriching) return;
    setEnriching(true);
    try {
      const res = await fetch("/api/admin/restaurants/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, restaurantId: currentRestaurant.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "정보를 불러오지 못했어요.");
        return;
      }
      handleRestaurantUpdated(data.restaurant);
      onNotify?.(`[${data.restaurant.name}] 최신 정보를 새로 불러왔어요.`);
    } catch {
      onNotify?.("네트워크 오류로 정보를 불러오지 못했어요.");
    } finally {
      setEnriching(false);
    }
  }

  function refreshMyEditRequests() {
    if (!currentRestaurant) return;
    fetch(
      `/api/edit-requests?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(currentRestaurant.id)}`
    )
      .then((res) => res.json())
      .then((data) => {
        const all = (data.requests ?? []) as RestaurantEditRequest[];
        const myId = toNicknameId(nickname);
        const mine = all.filter((r) => r.requestedByNicknameId === myId);
        setMyEditRequests(mine);
        writeCache(companyCode, currentRestaurant.id, { myEditRequests: mine });
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!currentRestaurant) return;
    setLoadError(null);
    setShowAllMenus(false);

    const key = cacheKeyFor(companyCode, currentRestaurant.id);
    const cached = detailCache.get(key);

    if (!cached) {
      setReviews([]);
      setZeroPayStatus(null);
      setTodayLogs(null);
      setMyEditRequests([]);
      setLoading(true);

      Promise.all([
        fetch(
          `/api/reviews?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(currentRestaurant.id)}`
        ).then((res) => res.json()),
        fetch(
          `/api/zeropay-votes?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(currentRestaurant.id)}`
        ).then((res) => res.json()),
        fetch(`/api/meal-logs?companyCode=${encodeURIComponent(companyCode)}&date=${todayDateKey()}`).then((res) =>
          res.json()
        ),
        fetch(
          `/api/edit-requests?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(currentRestaurant.id)}`
        ).then((res) => res.json()),
      ])
        .then(([reviewsData, zeroPayData, mealLogData, editRequestData]) => {
          const reviewList = (reviewsData.reviews ?? []) as ReviewSummary[];
          const logs = (mealLogData.logs ?? []) as MealLogEntry[];
          const allRequests = (editRequestData.requests ?? []) as RestaurantEditRequest[];
          const myId = toNicknameId(nickname);
          const mine = allRequests.filter((r) => r.requestedByNicknameId === myId);
          const status = zeroPayData as ZeroPayStatus;

          setReviews(reviewList);
          setZeroPayStatus(status);
          setTodayLogs(logs);
          setMyEditRequests(mine);

          detailCache.set(key, {
            reviews: reviewList,
            zeroPayStatus: status,
            todayLogs: logs,
            myEditRequests: mine,
            lastActivityAt: status?.lastActivityAt ?? null,
          });
        })
        .catch(() => setLoadError("정보를 불러오지 못했어요."))
        .finally(() => setLoading(false));
      return;
    }

    setTodayLogs(cached.todayLogs);
    setMyEditRequests(cached.myEditRequests);
    setReviews(cached.reviews);
    setZeroPayStatus(cached.zeroPayStatus);
    setLoading(false);

    fetch(`/api/restaurants/${currentRestaurant.id}/activity?companyCode=${encodeURIComponent(companyCode)}`)
      .then((res) => res.json())
      .then((data) => {
        const latest = (data.lastActivityAt as string | null) ?? null;
        if (latest === cached.lastActivityAt) return;

        return Promise.all([
          fetch(
            `/api/reviews?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(currentRestaurant.id)}`
          ).then((res) => res.json()),
          fetch(
            `/api/zeropay-votes?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(currentRestaurant.id)}`
          ).then((res) => res.json()),
        ]).then(([reviewsData, zeroPayData]) => {
          const reviewList = (reviewsData.reviews ?? []) as ReviewSummary[];
          const status = zeroPayData as ZeroPayStatus;
          setReviews(reviewList);
          setZeroPayStatus(status);
          writeCache(companyCode, currentRestaurant.id, {
            reviews: reviewList,
            zeroPayStatus: status,
            lastActivityAt: latest,
          });
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRestaurant?.id, companyCode]);

  if (!currentRestaurant) return null;

  const visual = getCategoryVisual(currentRestaurant.category, currentRestaurant.categoryLabel, currentRestaurant.name);
  const businessHoursLines = formatBusinessHours(currentRestaurant.businessHours);
  const facilities = currentRestaurant.facilities ?? [];
  const paymentMethods = currentRestaurant.paymentMethods ?? [];
  const menus = currentRestaurant.menus ?? [];
  const visibleMenus = showAllMenus ? menus : menus.slice(0, MENU_PREVIEW_COUNT);
  const remainingMenuCount = menus.length - MENU_PREVIEW_COUNT;
  const hasInfoBlock =
    Boolean(currentRestaurant.phone) ||
    businessHoursLines.length > 0 ||
    facilities.length > 0 ||
    paymentMethods.length > 0 ||
    Boolean(currentRestaurant.naverPlaceUrl);

  async function handleVote(vote: "up" | "down") {
    if (!currentRestaurant || voting) return;
    setVoting(true);
    try {
      const res = await fetch("/api/zeropay-votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, restaurantId: currentRestaurant.id, vote }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as ZeroPayStatus;
      setZeroPayStatus(data);
      writeCache(companyCode, currentRestaurant.id, { zeroPayStatus: data, lastActivityAt: data.lastActivityAt });
      onZeroPayStatusChange?.(currentRestaurant.id, data);
    } catch {
    } finally {
      setVoting(false);
    }
  }

  async function handleLogMealToday() {
    if (!currentRestaurant || loggingMeal) return;
    setLoggingMeal(true);
    try {
      const res = await fetch("/api/meal-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          date: todayDateKey(),
          restaurantId: currentRestaurant.id,
          restaurantName: currentRestaurant.name,
          category: currentRestaurant.category ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "기록을 남기지 못했어요.");
        return;
      }
      const nextLogs = [...(todayLogs ?? []), data.log as MealLogEntry];
      setTodayLogs(nextLogs);
      writeCache(companyCode, currentRestaurant.id, { todayLogs: nextLogs });
      onNotify?.("오늘 여기서 먹었다고 기록했어요.");
      onMealLogged?.();
    } catch {
      onNotify?.("네트워크 오류로 기록을 남기지 못했어요.");
    } finally {
      setLoggingMeal(false);
    }
  }

  async function handleRemoveTodayLog(id: string) {
    if (!currentRestaurant) return;
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
      const nextLogs = (todayLogs ?? []).filter((e) => e.id !== id);
      setTodayLogs(nextLogs);
      writeCache(companyCode, currentRestaurant.id, { todayLogs: nextLogs });
      onMealLogged?.();
    } catch {
      onNotify?.("네트워크 오류로 삭제하지 못했어요.");
    } finally {
      setDeletingLogId(null);
    }
  }

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!currentRestaurant || !commentText.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          restaurantId: currentRestaurant.id,
          content: commentText.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error ?? "댓글을 남기지 못했어요.");
        return;
      }

      const nextReviews = [data.review, ...reviews];
      setReviews(nextReviews);
      writeCache(companyCode, currentRestaurant.id, { reviews: nextReviews, lastActivityAt: data.lastActivityAt });
      setCommentText("");
    } catch {
      setSubmitError("네트워크 오류로 댓글을 남기지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  const effectiveIsZeroPay = zeroPayStatus ? zeroPayStatus.effectiveIsZeroPay : currentRestaurant.isZeroPay;
  const needsReview = zeroPayStatus ? zeroPayStatus.needsReview : currentRestaurant.isZeroPayNeedsReview;

  return (
    <>
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl2 bg-surface p-6 sm:p-7 shadow-soft"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">{visual.emoji}</span>
              <div>
                <h2 className="text-lg font-bold text-ink">{currentRestaurant.displayName || currentRestaurant.name}</h2>
                {currentRestaurant.businessName && currentRestaurant.businessName !== (currentRestaurant.displayName || currentRestaurant.name) && (
                  <p className="text-[11px] text-ink-soft/80">
                    (등록 상호: {currentRestaurant.businessName})
                  </p>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{currentRestaurant.address}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* 관리자 전용 가맹점 정보 수동수집 (새로고침) 버튼 - 즐겨찾기 왼쪽에 배치 */}
            {isAdminUser && (
              <button
                onClick={handleEnrichRestaurant}
                disabled={enriching}
                aria-label="가맹점 정보 수동 수집 (새로고침)"
                title="가맹점 정보 새로고침 (네이버맵/제로페이)"
                className="rounded-full p-1 text-lg leading-none transition hover:bg-surface-muted disabled:opacity-50"
              >
                {enriching ? "⏳" : "🔄"}
              </button>
            )}
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

        {currentRestaurant.aiBriefing && (
          <p className="mt-1.5 text-sm italic text-ink-soft">“{currentRestaurant.aiBriefing}”</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
            {visual.label}
          </span>
          {typeof currentRestaurant.distanceMeters === "number" && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
              {currentRestaurant.distanceMeters}m
            </span>
          )}
          {currentRestaurant.discountInfo?.benefit && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              🏷️ 제휴할인
            </span>
          )}
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

        {(currentRestaurant.discountInfo?.benefit || currentRestaurant.discountInfo?.note) && (
          <div className="mt-3 rounded-xl2 border border-emerald-500/20 bg-emerald-50/70 p-3 text-sm text-emerald-950">
            <div className="flex items-center gap-1.5 font-bold text-emerald-900">
              <span>🎁</span>
              <span>제휴 혜택</span>
              {currentRestaurant.discountInfo?.benefit && (
                <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-xs text-white">
                  {currentRestaurant.discountInfo.benefit}
                </span>
              )}
            </div>
            {currentRestaurant.discountInfo?.note && (
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-800/90">
                📌 {currentRestaurant.discountInfo.note}
              </p>
            )}
          </div>
        )}

        {hasInfoBlock && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl2 bg-surface-muted p-3 text-sm">
            {currentRestaurant.phone && (
              <a
                href={`tel:${currentRestaurant.phone}`}
                className="flex items-center gap-1.5 text-ink transition hover:text-primary-dark"
              >
                <span>📞</span>
                <span>{currentRestaurant.phone}</span>
              </a>
            )}

            {businessHoursLines.length > 0 && (
              <div className="flex items-start gap-1.5 text-ink-soft">
                <span className="shrink-0 mt-0.5">🕒</span>
                <div className="flex flex-col gap-0.5">
                  {businessHoursLines.map((line, i) => (
                    <span key={i} className={`text-sm ${line.startsWith("ℹ️") ? "text-amber-600 text-xs font-normal mt-0.5" : "font-medium text-ink"}`}>
                      {line}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {facilities.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5">🏷️</span>
                {facilities.map((f, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}

            {paymentMethods.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5">💳</span>
                {paymentMethods.map((p, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}

            {currentRestaurant.naverPlaceUrl && (
              <a
                href={currentRestaurant.naverPlaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary-dark underline"
              >
                네이버지도에서 보기 ↗
              </a>
            )}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={handleLogMealToday}
            disabled={loggingMeal}
            className="flex-1 rounded-xl2 bg-surface-muted px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-primary-light hover:text-primary-dark disabled:opacity-70"
          >
            {loggingMeal ? "기록하는 중..." : "오늘 여기서 먹었어요"}
          </button>
          
          {/* 관리자는 "정보수정" (즉시 수정 모달), 일반 사용자는 "정보수정요청" 모달 */}
          {isAdminUser ? (
            <button
              onClick={() => setShowAdminDirectEdit(true)}
              className="flex-1 rounded-xl2 bg-primary/10 border border-primary/30 px-3 py-2.5 text-sm font-bold text-primary-dark transition hover:bg-primary/20"
            >
              ✏️ 정보수정
            </button>
          ) : (
            <button
              onClick={() => setShowEditRequest(true)}
              className="flex-1 rounded-xl2 border border-dashed border-black/15 px-3 py-2.5 text-sm font-medium text-ink-soft transition hover:border-primary/40 hover:text-primary-dark"
            >
              정보수정요청
            </button>
          )}
        </div>

        {myEditRequests.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {myEditRequests.map((req) => (
              <li
                key={req.id}
                className="flex items-start justify-between gap-2 rounded-xl2 bg-surface-muted p-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{EDIT_REQUEST_TYPE_LABELS[req.type]}</p>
                  <p className="mt-0.5 truncate text-ink-soft">
                    {summarizeEditRequest(req.type, req.payload)}
                  </p>
                </div>
                <span
                  className={[
                    "shrink-0 rounded-full px-2 py-0.5 font-medium",
                    req.status === "pending"
                      ? "bg-amber-100 text-amber-700"
                      : req.status === "resolved"
                        ? "bg-primary-light text-primary-dark"
                        : "bg-black/10 text-ink-soft",
                  ].join(" ")}
                >
                  {req.status === "pending" ? "대기중" : req.status === "resolved" ? "처리됨" : "거절됨"}
                </span>
              </li>
            ))}
          </ul>
        )}

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

        <div className="mt-3 flex items-center gap-2 rounded-xl2 bg-surface-muted p-3">
          <p className="flex-1 text-xs text-ink-soft">비플페이 되나요?</p>
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

        {menus.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-2 text-sm font-semibold text-ink">메뉴</h3>
            <ul className="flex flex-col gap-2">
              {visibleMenus.map((menu, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-xl2 bg-surface-muted p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 flex-wrap">
                        <span className="truncate text-sm font-medium text-ink">{menu.name}</span>
                        {(menu.tags ?? (menu.isRepresentative ? ['대표'] : [])).map((tag, tagIdx) => (
                          <span
                            key={tagIdx}
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              tag === '인기'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-primary-light text-primary-dark'
                            }`}
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                      {menu.price && (
                        <span className="shrink-0 text-sm text-ink-soft">
                          {formatMenuPrice(menu.price)}
                        </span>
                      )}
                    </div>
                    {menu.description && (
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{menu.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {remainingMenuCount > 0 && (
              <button
                onClick={() => setShowAllMenus((prev) => !prev)}
                className="mt-2 w-full rounded-xl2 bg-surface px-3 py-2 text-xs font-medium text-ink-soft transition hover:bg-surface-muted"
              >
                {showAllMenus ? "메뉴 접기" : `메뉴 더보기 (${remainingMenuCount}개 더)`}
              </button>
            )}
          </div>
        )}

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

    <EditRequestModal
      open={showEditRequest}
      companyCode={companyCode}
      restaurantId={currentRestaurant.id}
      restaurantName={currentRestaurant.name}
      onClose={() => setShowEditRequest(false)}
      onSubmitted={refreshMyEditRequests}
      onNotify={onNotify}
    />

    {showAdminDirectEdit && (
      <AdminDirectEditModal
        open={showAdminDirectEdit}
        companyCode={companyCode}
        restaurant={currentRestaurant}
        onClose={() => setShowAdminDirectEdit(false)}
        onSuccess={handleRestaurantUpdated}
        onNotify={onNotify}
      />
    )}
    </>
  );
}
