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

function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 2026-08-11 개편(firestore 과잉사용 분석 반영 - "방법 A" 변경감지 캐싱): 식당 상세모달의 4개
// 데이터는 성격이 다르다.
//   - todayLogs(오늘 내 기록), myEditRequests(내가 보낸 수정요청) - 오직 "나"의 행동으로만
//     바뀐다. 이 컴포넌트 안의 액션(handleLogMealToday 등) 이후에 바로 캐시에 반영해두므로,
//     같은 식당을 다시 열 때는 시간 제한 없이 캐시를 그대로 써도 안전하다.
//   - reviews(댓글), zeroPayStatus(제로페이 투표) - 다른 동료도 바꿀 수 있다. 그래서 예전엔
//     30초 TTL로 "일정 시간 지나면 무조건 다시 불러오기"를 했는데, 이제는 식당 문서의
//     lastActivityAt 필드(리뷰 작성/투표 시 갱신 - review-server.ts, zeropay-server.ts 참고)
//     하나만 가볍게 확인해서(GET /api/restaurants/{id}/activity, 문서 1건 읍기) 캐시해둔 값과
//     다를 때만 실제로 다시 불러온다. 즉 시간이 아니라 "실제 변경 여부"로 판단한다.
// 캐시 자체는 시간 만료가 없고(세션 내내 유지), 자정을 넘기면 todayLogs가 "오늘"이 아니게 되니
// 키에 오늘 날짜를 포함시켜서 날짜가 바뀌면 자연히 새 키로 다시 전체 로딩되게 한다.
interface DetailCacheEntry {
  reviews: ReviewSummary[];
  zeroPayStatus: ZeroPayStatus | null;
  todayLogs: MealLogEntry[];
  myEditRequests: RestaurantEditRequest[];
  // reviews/zeroPayStatus를 마지막으로 불러왔을 때 서버가 알려준 lastActivityAt. 재오픈 시 이
  // 값을 다시 확인해서 서버 쪽 값과 같으면 reviews/zeroPayStatus는 캐시를 그대로 쓴다.
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

// 2026-08-09 신규: businessHours는 네이버 내부(Apollo 캐시) 응답을 그대로 저장해둔 값이라
// 문자열/배열/객체 등 형태가 일정하지 않다. 어떤 형태든 안 죽고 "요일: 시간" 비슷한 줄 목록으로
// 최대한 뽑아내고, 못 알아보는 형태면 조용히 빈 배열을 반환한다(그 경우 화면에 그냥 안 보임).
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

  // 요일 그룹화 처리 (예: 월~토: 07:30 ~ 20:30)
  const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
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

  // 시간대가 같은 연속된 요일을 묶어준다 (예: 월~토: 07:30 ~ 20:30)
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

// 2026-08-09 신규: 메뉴 가격에 1,000단위 콤마를 붙여준다. 원본이 "12000"처럼 숫자만 오거나
// "12000원"처럼 단위가 붙어 오거나, "10000~15000"처럼 범위로 오는 경우까지 방어적으로 처리한다.
// 숫자를 하나도 못 찾으면(예: "가격문의") 원본 그대로 돌려준다.
function formatMenuPrice(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // "~" 또는 "-"로 범위 표기된 경우 구분자를 유지한 채 각 숫자 구간만 콤마 처리한다.
  const segments = trimmed.split(/([~\-])/);
  const formattedSegments = segments.map((segment) => {
    if (segment === "~" || segment === "-") return segment;
    const digits = segment.replace(/[^0-9]/g, "");
    if (!digits) return segment; // 숫자가 전혀 없는 구간(예: "가격문의")은 그대로 둔다
    return Number(digits).toLocaleString("ko-KR");
  });

  const joined = formattedSegments.join("");
  return /원/.test(joined) ? joined : `${joined}원`;
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

// 2026-08-09 신규: 메뉴 목록은 기본 5개까지만 보여주고, "더보기"를 눌러야 나머지가 펼쳐진다
// (enrich 스크립트가 최대 10개까지 저장해두니 그 이상 늘어나도 카드 하나가 너무 길어지지 않게).
const MENU_PREVIEW_COUNT = 5;

// 마커 클릭 / 리스트 클릭으로 열리는 식당 상세 모달. 처음 열 때는 4개 데이터(댓글/제로페이 현황/
// 오늘 내 기록/내 수정요청)를 서버에서 새로 불러오고, 그 다음부터는 위 detailCache를 활용한다
// (같은 식당을 다시 열면 todayLogs/myEditRequests는 무조건 캐시, reviews/zeroPayStatus는
// lastActivityAt 변경 감지 결과에 따라 캐시 또는 재조회).
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

  // 2026-08-09 신규: 메뉴 "더보기" 펼침 상태. 식당이 바뀌면 다시 접힌 상태로 시작해야 하니
  // 아래 restaurant 변경 useEffect에서 같이 초기화한다.
  const [showAllMenus, setShowAllMenus] = useState(false);

  // 2026-08-09 신규: "정보 수정 요청" 모달 상태 + 내가 이 식당에 보낸 요청 목록(상태 확인용).
  const [showEditRequest, setShowEditRequest] = useState(false);
  const [myEditRequests, setMyEditRequests] = useState<RestaurantEditRequest[]>([]);

  function refreshMyEditRequests() {
    if (!restaurant) return;
    fetch(
      `/api/edit-requests?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
    )
      .then((res) => res.json())
      .then((data) => {
        const all = (data.requests ?? []) as RestaurantEditRequest[];
        const myId = toNicknameId(nickname);
        const mine = all.filter((r) => r.requestedByNicknameId === myId);
        setMyEditRequests(mine);
        writeCache(companyCode, restaurant.id, { myEditRequests: mine });
      })
      .catch(() => {
        // 내 요청 상태는 부가 정보라 실패해도 조용히 무시.
      });
  }

  useEffect(() => {
    if (!restaurant) return;
    setLoadError(null);
    setShowAllMenus(false);

    const key = cacheKeyFor(companyCode, restaurant.id);
    const cached = detailCache.get(key);

    // 이 식당을 처음 여는 경우(또는 자정이 지나 캐시 키 자체가 바뀐 경우) - 4개 전부 새로 불러온다.
    if (!cached) {
      setReviews([]);
      setZeroPayStatus(null);
      setTodayLogs(null);
      setMyEditRequests([]);
      setLoading(true);

      Promise.all([
        fetch(
          `/api/reviews?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
        ).then((res) => res.json()),
        fetch(
          `/api/zeropay-votes?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
        ).then((res) => res.json()),
        fetch(`/api/meal-logs?companyCode=${encodeURIComponent(companyCode)}&date=${todayDateKey()}`).then((res) =>
          res.json()
        ),
        fetch(
          `/api/edit-requests?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
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

    // 캐시가 있다. todayLogs/myEditRequests는 오직 "나"의 행동으로만 바뀌고, 그 행동 이후엔
    // 이미 캐시에 반영해뒀으니 여기서는 무조건 그대로 쓴다(재조회 없음).
    setTodayLogs(cached.todayLogs);
    setMyEditRequests(cached.myEditRequests);
    // reviews/zeroPayStatus는 우선 캐시로 즉시 보여준다 - 다른 동료가 바꿨는지는 아래에서 확인.
    setReviews(cached.reviews);
    setZeroPayStatus(cached.zeroPayStatus);
    setLoading(false);

    fetch(`/api/restaurants/${restaurant.id}/activity?companyCode=${encodeURIComponent(companyCode)}`)
      .then((res) => res.json())
      .then((data) => {
        const latest = (data.lastActivityAt as string | null) ?? null;
        if (latest === cached.lastActivityAt) return; // 변경 없음 - 캐시 그대로 유지

        return Promise.all([
          fetch(
            `/api/reviews?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
          ).then((res) => res.json()),
          fetch(
            `/api/zeropay-votes?companyCode=${encodeURIComponent(companyCode)}&restaurantId=${encodeURIComponent(restaurant.id)}`
          ).then((res) => res.json()),
        ]).then(([reviewsData, zeroPayData]) => {
          const reviewList = (reviewsData.reviews ?? []) as ReviewSummary[];
          const status = zeroPayData as ZeroPayStatus;
          setReviews(reviewList);
          setZeroPayStatus(status);
          writeCache(companyCode, restaurant.id, {
            reviews: reviewList,
            zeroPayStatus: status,
            lastActivityAt: latest,
          });
        });
      })
      .catch(() => {
        // 변경 감지 실패는 부가 기능이라 조용히 무시 - 캐시된 값을 그대로 보여준 채로 둔다.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant, companyCode]);

  if (!restaurant) return null;

  const visual = getCategoryVisual(restaurant.category, restaurant.categoryLabel, restaurant.name);

  // 2026-08-09 신규: scripts/enrich-naver-details.ts가 수집해둔 부가정보. 없으면 각 섹션은
  // 조건부로 아예 렌더링하지 않는다(엔리치먼트 전 식당은 여전히 예전 모습 그대로 보임).
  const businessHoursLines = formatBusinessHours(restaurant.businessHours);
  const facilities = restaurant.facilities ?? [];
  const paymentMethods = restaurant.paymentMethods ?? [];
  const menus = restaurant.menus ?? [];
  const visibleMenus = showAllMenus ? menus : menus.slice(0, MENU_PREVIEW_COUNT);
  const remainingMenuCount = menus.length - MENU_PREVIEW_COUNT;
  const hasInfoBlock =
    Boolean(restaurant.phone) ||
    businessHoursLines.length > 0 ||
    facilities.length > 0 ||
    paymentMethods.length > 0 ||
    Boolean(restaurant.naverPlaceUrl);

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
      // 서버가 방금 이 투표로 갱신한 lastActivityAt을 같이 돌려주므로, 그 값 그대로 캐시에
      // 반영해서 다음에 이 식당을 다시 열 때 불필요한 재조회가 안 나가게 한다.
      writeCache(companyCode, restaurant.id, { zeroPayStatus: data, lastActivityAt: data.lastActivityAt });
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
      const nextLogs = [...(todayLogs ?? []), data.log as MealLogEntry];
      setTodayLogs(nextLogs);
      writeCache(companyCode, restaurant.id, { todayLogs: nextLogs });
      onNotify?.("오늘 여기서 먹었다고 기록했어요.");
      onMealLogged?.();
    } catch {
      onNotify?.("네트워크 오류로 기록을 남기지 못했어요.");
    } finally {
      setLoggingMeal(false);
    }
  }

  async function handleRemoveTodayLog(id: string) {
    if (!restaurant) return;
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
      writeCache(companyCode, restaurant.id, { todayLogs: nextLogs });
      onMealLogged?.();
    } catch {
      onNotify?.("네트워크 오류로 삭제하지 못했어요.");
    } finally {
      setDeletingLogId(null);
    }
  }

  async function handleSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurant || !commentText.trim()) return;

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

      const nextReviews = [data.review, ...reviews];
      setReviews(nextReviews);
      // 서버가 방금 이 댓글로 갱신한 lastActivityAt을 같이 돌려주므로, 그 값 그대로 캐시에
      // 반영한다(다음 재오픈 시 불필요한 변경감지 재조회 방지).
      writeCache(companyCode, restaurant.id, { reviews: nextReviews, lastActivityAt: data.lastActivityAt });
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
                <h2 className="text-lg font-bold text-ink">{restaurant.displayName || restaurant.name}</h2>
                {restaurant.businessName && restaurant.businessName !== (restaurant.displayName || restaurant.name) && (
                  <p className="text-[11px] text-ink-soft/80">
                    (등록 상호: {restaurant.businessName})
                  </p>
                )}
              </div>
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

        {/* 2026-08-09 신규: 네이버 AI 한줄 요약 - scripts/enrich-naver-details.ts가 수집해둔
            aiBriefing. 없는 식당은 그냥 안 보임. */}
        {restaurant.aiBriefing && (
          <p className="mt-1.5 text-sm italic text-ink-soft">“{restaurant.aiBriefing}”</p>
        )}

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
          {restaurant.discountInfo?.benefit && (
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

        {/* 사내 제휴 혜택 정보 박스 */}
        {(restaurant.discountInfo?.benefit || restaurant.discountInfo?.note) && (
          <div className="mt-3 rounded-xl2 border border-emerald-500/20 bg-emerald-50/70 p-3 text-sm text-emerald-950">
            <div className="flex items-center gap-1.5 font-bold text-emerald-900">
              <span>🎁</span>
              <span>제휴 혜택</span>
              {restaurant.discountInfo?.benefit && (
                <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-xs text-white">
                  {restaurant.discountInfo.benefit}
                </span>
              )}
            </div>
            {restaurant.discountInfo?.note && (
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-800/90">
                📌 {restaurant.discountInfo.note}
              </p>
            )}
          </div>
        )}

        {/* 2026-08-09 신규: 전화/영업시간/편의시설/결제수단/네이버지도 링크 - 지금까지 DB에는
            있었지만 화면엔 안 보이던 정보들을 한 블록에 모아서 노출. 데이터가 하나도 없는
            식당(아직 enrich 스크립트를 안 거친 곳)은 이 블록 자체가 안 보인다. */}
        {hasInfoBlock && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl2 bg-surface-muted p-3 text-sm">
            {restaurant.phone && (
              <a
                href={`tel:${restaurant.phone}`}
                className="flex items-center gap-1.5 text-ink transition hover:text-primary-dark"
              >
                <span>📞</span>
                <span>{restaurant.phone}</span>
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

            {restaurant.naverPlaceUrl && (
              <a
                href={restaurant.naverPlaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary-dark underline"
              >
                네이버지도에서 보기 ↗
              </a>
            )}
          </div>
        )}

        {/* 2026-08-09: "오늘 여기서 먹었어요" / 정보 수정요청 두 버튼을 한 줄에 나란히 배치.
            "오늘 여기서 먹었어요" - 밥 먹은 기록(캘린더뷰)에 오늘 날짜로 새 기록을 추가한다.
            하루에 여러 건(회식 등) 가능해서 이미 기록이 있어도 계속 추가할 수 있고, 오늘 이미
            남긴 기록은 아래 칩으로 보여주고 바로 지울 수도 있다. "정보 수정"은 전화/영업시간/
            카테고리/메뉴/폐업이전/제로페이여부 중 하나를 골라 구조화된 값으로 제출하는 모달을
            연다(EditRequestModal.tsx). */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleLogMealToday}
            disabled={loggingMeal}
            className="flex-1 rounded-xl2 bg-surface-muted px-3 py-2.5 text-sm font-medium text-ink transition hover:bg-primary-light hover:text-primary-dark disabled:opacity-70"
          >
            {loggingMeal ? "기록하는 중..." : "오늘 여기서 먹었어요"}
          </button>
          <button
            onClick={() => setShowEditRequest(true)}
            className="flex-1 rounded-xl2 border border-dashed border-black/15 px-3 py-2.5 text-sm font-medium text-ink-soft transition hover:border-primary/40 hover:text-primary-dark"
          >
            정보수정요청
          </button>
        </div>

        {/* 내가 이 식당에 보낸 수정요청이 있으면 상태(대기중/처리됨/거절됨)를 여기 보여준다. */}
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

        {/* 제로페이 엄지척/거꾸로엄지척 투표. "됨" 표시가 있어도 최근 거꾸로엄지척이 많아지면
            needsReview 배지가 뜨니, 이 버튼들로 계속 최신 상태를 유지해간다. */}
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

        {/* 2026-08-09 신규: 메뉴 - scripts/enrich-naver-details.ts가 수집해둔 menus(이름/가격/
            설명). 없는 식당은 섹션 자체가 안 보인다. 기본 5개만 보여주고 나머지는 "더보기"로. */}
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
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      onClose={() => setShowEditRequest(false)}
      onSubmitted={refreshMyEditRequests}
      onNotify={onNotify}
    />
    </>
  );
}
