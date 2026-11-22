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
import Icon from "./ui/Icon";
import { useModalBehavior } from "@/hooks/useModalBehavior";

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

type HoursLine = { text: string; isNote: boolean };

// 네이버 영업시간을 "요일 범위 : 시간" 줄로 묶는다.
// 네이버 원문은 "월 11:30 - 22:00" 다음 줄에 "20:30 라스트오더"처럼 요일 없는 줄이 붙어 나와서,
// 예전엔 라스트오더 줄들이 맨 아래로 모여 어느 요일 것인지 알 수 없었다. 바로 앞 요일에 붙이되,
// 네이버가 일부 요일에만 라스트오더를 주는 경우가 많아 묶을 때는 영업시간만 비교한다.
function formatBusinessHours(raw: unknown): HoursLine[] {
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

  const parsedDayHours: Array<{ day: string; time: string; lastOrder?: string }> = [];
  const extraLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([월화수목금토일])(?:요일)?\s*[:\-\s]?\s*(.+)$/);
    if (match) {
      parsedDayHours.push({ day: match[1], time: match[2].trim().replace(/\s*-\s*/, " ~ ") });
      continue;
    }
    const lastOrder = line.match(/^(\d{1,2}:\d{2})\s*라스트\s*오더$/);
    const prev = parsedDayHours[parsedDayHours.length - 1];
    if (lastOrder && prev) {
      prev.lastOrder = lastOrder[1];
      continue;
    }
    extraLines.push(line.replace(/^-\s*/, "").trim());
  }

  if (parsedDayHours.length === 0) {
    return lines.map((text) => ({ text, isNote: false }));
  }

  const grouped: HoursLine[] = [];
  let currentGroup: { startDay: string; endDay: string; time: string; lastOrder?: string } | null = null;
  const flush = () => {
    if (!currentGroup) return;
    const dayRange =
      currentGroup.startDay === currentGroup.endDay
        ? currentGroup.startDay
        : `${currentGroup.startDay}~${currentGroup.endDay}`;
    const lastOrderText = currentGroup.lastOrder ? ` (라스트오더 ${currentGroup.lastOrder})` : "";
    grouped.push({ text: `${dayRange} ${currentGroup.time}${lastOrderText}`, isNote: false });
  };

  for (const item of parsedDayHours) {
    if (currentGroup && currentGroup.time === item.time) {
      currentGroup.endDay = item.day;
      currentGroup.lastOrder ??= item.lastOrder;
    } else {
      flush();
      currentGroup = { startDay: item.day, endDay: item.day, time: item.time, lastOrder: item.lastOrder };
    }
  }
  flush();

  return [...grouped, ...extraLines.map((text) => ({ text, isNote: true }))];
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
  openedFromSearch?: boolean;
  onBackToSearch?: () => void;
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
  openedFromSearch = false,
  onBackToSearch,
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

  useModalBehavior(initialRestaurant !== null, onClose);

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
  const displayName = currentRestaurant.displayName || currentRestaurant.name;
  const walkingText =
    typeof currentRestaurant.distanceMeters === "number"
      ? currentRestaurant.walkingMinutes
        ? `도보 ${currentRestaurant.walkingMinutes}분 (${currentRestaurant.walkingMeters}m)`
        : `도보 약 ${Math.max(1, Math.round((currentRestaurant.distanceMeters * 1.35) / 67))}분 (${Math.round(currentRestaurant.distanceMeters * 1.35)}m)`
      : null;

  // 순서: 이름/거리/결제 → 제휴 혜택 → 메뉴 → 행동 버튼 → 매장 정보(네이버) → 제로페이 투표 → 댓글.
  // 모바일은 아래에서 올라오는 시트, 데스크톱은 가운데 창.
  return (
    <>
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center md:px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={displayName}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-2xl animate-fade-in overflow-y-auto rounded-t-2xl bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 shadow-soft md:max-h-[85dvh] md:rounded-2xl md:p-7"
      >
        {openedFromSearch && onBackToSearch && (
          <button
            type="button"
            onClick={onBackToSearch}
            className="mb-3 inline-flex items-center gap-1 rounded-full bg-surface-muted py-1 pl-2 pr-3 text-xs font-semibold text-ink-soft transition hover:text-ink"
          >
            <Icon name="chevronLeft" className="h-3.5 w-3.5" />
            검색 결과
          </button>
        )}

        {/* 머리: 이름, 주소, 버튼 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-snug text-ink">{displayName}</h2>
            {currentRestaurant.businessName && currentRestaurant.businessName !== displayName && (
              <p className="mt-0.5 text-xs text-ink-soft">등록 상호 {currentRestaurant.businessName}</p>
            )}
            <p className="mt-1 text-sm text-ink-soft">{currentRestaurant.address}</p>
          </div>
          <div className="-mr-2 -mt-1 flex shrink-0 items-center">
            {isAdminUser && (
              <button
                onClick={handleEnrichRestaurant}
                disabled={enriching}
                aria-label="네이버·제로페이 정보 다시 불러오기 (관리자)"
                title="정보 다시 불러오기 (관리자)"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-muted disabled:opacity-50"
              >
                <Icon name="refresh" className={enriching ? "h-5 w-5 animate-spin" : "h-5 w-5"} />
              </button>
            )}
            <button
              onClick={onToggleFavorite}
              aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              aria-pressed={isFavorite}
              className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-surface-muted"
            >
              <Icon
                name="heart"
                filled={isFavorite}
                className={isFavorite ? "h-5 w-5 text-primary" : "h-5 w-5 text-ink-soft"}
              />
            </button>
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-muted"
              aria-label="닫기"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-ink-soft">{visual.label}</span>
          {walkingText && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-ink-soft">
              <Icon name="walk" className="h-3.5 w-3.5" />
              {walkingText}
            </span>
          )}
          {effectiveIsZeroPay && (
            <span className="rounded-full bg-primary-light px-2.5 py-1 font-medium text-primary-dark">제로페이 가능</span>
          )}
          {needsReview && (
            <span className="rounded-full bg-warning-light px-2.5 py-1 font-medium text-warning-dark">
              결제 안 된다는 제보 있음
            </span>
          )}
        </div>

        {(currentRestaurant.discountInfo?.benefit || currentRestaurant.discountInfo?.note) && (
          <div className="mt-4 rounded-xl border border-success/20 bg-success-light p-3.5 text-sm text-success-dark">
            <div className="flex items-center gap-2 font-semibold">
              <Icon name="gift" className="h-4 w-4" />
              제휴 혜택
              {currentRestaurant.discountInfo?.benefit && (
                <span className="rounded-md bg-success px-1.5 py-0.5 text-xs text-white">
                  {currentRestaurant.discountInfo.benefit}
                </span>
              )}
            </div>
            {currentRestaurant.discountInfo?.note && (
              <p className="mt-1.5 text-xs leading-relaxed">{currentRestaurant.discountInfo.note}</p>
            )}
          </div>
        )}

        {/* 메뉴 */}
        {menus.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-ink">메뉴</h3>
            <ul className="divide-y divide-black/5 rounded-xl border border-black/5">
              {visibleMenus.map((menu, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-ink">{menu.name}</span>
                      {(menu.tags ?? (menu.isRepresentative ? ["대표"] : [])).map((tag, tagIdx) => (
                        <span
                          key={tagIdx}
                          className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs text-ink-soft"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {menu.description && (
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{menu.description}</p>
                    )}
                  </div>
                  {menu.price && (
                    <span className="shrink-0 text-sm font-medium text-ink">{formatMenuPrice(menu.price)}</span>
                  )}
                </li>
              ))}
            </ul>

            {remainingMenuCount > 0 && (
              <button
                onClick={() => setShowAllMenus((prev) => !prev)}
                className="mt-2 w-full rounded-xl px-3 py-2 text-xs font-medium text-ink-soft transition hover:bg-surface-muted"
              >
                {showAllMenus ? "메뉴 접기" : `메뉴 ${remainingMenuCount}개 더 보기`}
              </button>
            )}
          </section>
        )}

        {/* 행동 버튼 */}
        <div className="mt-5 flex gap-2">
          <button
            onClick={handleLogMealToday}
            disabled={loggingMeal}
            className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-70"
          >
            {loggingMeal ? "기록하는 중..." : "오늘 여기서 먹었어요"}
          </button>
          {isAdminUser ? (
            <button
              onClick={() => setShowAdminDirectEdit(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-black/10 px-4 py-3 text-sm font-medium text-ink transition hover:bg-surface-muted"
            >
              <Icon name="edit" className="h-4 w-4" />
              정보 수정
            </button>
          ) : (
            <button
              onClick={() => setShowEditRequest(true)}
              className="rounded-xl border border-black/10 px-4 py-3 text-sm font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink"
            >
              정보 수정 요청
            </button>
          )}
        </div>

        {todayLogs && todayLogs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {todayLogs.map((log) => (
              <span
                key={log.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary-light py-1 pl-2.5 pr-1 text-xs text-primary-dark"
              >
                <Icon name="check" className="h-3.5 w-3.5" />
                오늘 {log.restaurantName}
                <button
                  onClick={() => handleRemoveTodayLog(log.id)}
                  disabled={deletingLogId === log.id}
                  aria-label="오늘 기록 삭제"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-primary-dark/70 hover:bg-primary/10 hover:text-primary-dark"
                >
                  <Icon name="close" className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {myEditRequests.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {myEditRequests.map((req) => (
              <li
                key={req.id}
                className="flex items-start justify-between gap-2 rounded-xl bg-surface-muted p-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{EDIT_REQUEST_TYPE_LABELS[req.type]}</p>
                  <p className="mt-0.5 truncate text-ink-soft">{summarizeEditRequest(req.type, req.payload)}</p>
                </div>
                <span
                  className={[
                    "shrink-0 rounded-full px-2 py-0.5 font-medium",
                    req.status === "pending"
                      ? "bg-warning-light text-warning-dark"
                      : req.status === "resolved"
                        ? "bg-success-light text-success-dark"
                        : "bg-black/10 text-ink-soft",
                  ].join(" ")}
                >
                  {req.status === "pending" ? "대기중" : req.status === "resolved" ? "처리됨" : "거절됨"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* 매장 정보 (네이버 지도에서 가져온 참고 정보) */}
        {hasInfoBlock && (
          <section className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-ink">매장 정보</h3>
            <div className="flex flex-col gap-2.5 rounded-xl bg-surface-muted p-3.5 text-sm">
              {currentRestaurant.phone && (
                <a
                  href={`tel:${currentRestaurant.phone}`}
                  className="flex items-center gap-2 text-ink transition hover:text-primary-dark"
                >
                  <Icon name="phone" className="h-4 w-4 shrink-0 text-ink-soft" />
                  {currentRestaurant.phone}
                </a>
              )}

              {businessHoursLines.length > 0 && (
                <div className="flex items-start gap-2">
                  <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                  <div className="flex flex-col gap-0.5">
                    {businessHoursLines.map((line, i) => (
                      <span key={i} className={line.isNote ? "text-xs text-ink-soft" : "text-ink"}>
                        {line.text}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {paymentMethods.length > 0 && (
                <div className="flex items-start gap-2">
                  <Icon name="card" className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                  <span className="text-ink">{paymentMethods.join(", ")}</span>
                </div>
              )}

              {facilities.length > 0 && (
                <div className="flex items-start gap-2">
                  <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                  <span className="text-ink-soft">{facilities.join(" · ")}</span>
                </div>
              )}

              <p className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-2.5 text-xs text-ink-soft">
                <span>네이버 지도 기준 정보라 실제와 다를 수 있어요.</span>
                {currentRestaurant.naverPlaceUrl && (
                  <a
                    href={currentRestaurant.naverPlaceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-ink transition hover:text-primary-dark"
                  >
                    네이버 지도
                    <Icon name="external" className="h-3 w-3" />
                  </a>
                )}
              </p>
            </div>
          </section>
        )}

        {/* 제로페이 투표. 판정 우선순위는 관리자 설정 > 제로페이 공식 사이트 확인 > 투표 */}
        <div className="mt-4 rounded-xl border border-black/5 p-3.5">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-ink">제로페이 결제 되나요?</p>
            <button
              onClick={() => handleVote("up")}
              disabled={voting}
              aria-label="제로페이 결제 됨"
              aria-pressed={zeroPayStatus?.myVote === "up"}
              className={[
                "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition disabled:opacity-60",
                zeroPayStatus?.myVote === "up"
                  ? "bg-primary text-white"
                  : "bg-surface-muted text-ink-soft hover:bg-primary-light hover:text-primary-dark",
              ].join(" ")}
            >
              <Icon name="thumbsUp" className="h-4 w-4" />
              {zeroPayStatus?.upCount ?? 0}
            </button>
            <button
              onClick={() => handleVote("down")}
              disabled={voting}
              aria-label="제로페이 결제 안 됨"
              aria-pressed={zeroPayStatus?.myVote === "down"}
              className={[
                "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition disabled:opacity-60",
                zeroPayStatus?.myVote === "down"
                  ? "bg-ink text-white"
                  : "bg-surface-muted text-ink-soft hover:bg-black/[0.08]",
              ].join(" ")}
            >
              <Icon name="thumbsDown" className="h-4 w-4" />
              {zeroPayStatus?.downCount ?? 0}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">
            제로페이 공식 가맹점 조회와 관리자 확인 결과가 투표보다 우선해요.
          </p>
        </div>

        {/* 댓글 */}
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-bold text-ink">댓글</h3>

          {loading && <p className="text-sm text-ink-soft">불러오는 중...</p>}
          {loadError && <p className="text-sm text-danger">{loadError}</p>}
          {!loading && !loadError && reviews.length === 0 && (
            <p className="text-sm text-ink-soft">아직 댓글이 없어요.</p>
          )}

          <ul className="flex flex-col gap-2">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-xl bg-surface-muted p-3">
                <p className="text-sm text-ink">{review.content}</p>
                <p className="mt-1 text-xs text-ink-soft">{review.authorNickname}</p>
              </li>
            ))}
          </ul>

          <form onSubmit={handleSubmitComment} className="mt-3 flex flex-col gap-2">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="댓글 남기기"
              rows={2}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {submitError && <p className="text-xs text-danger">{submitError}</p>}
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="self-end rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40"
            >
              {submitting ? "등록 중..." : "등록"}
            </button>
          </form>
        </section>
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
