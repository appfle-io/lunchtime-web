"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import BottomSheet from "./BottomSheet";
import LoadingOverlay from "./LoadingOverlay";
import Icon, { type IconName } from "./ui/Icon";
import type { RestaurantSummary } from "@/types";
import { useModalBehavior } from "@/hooks/useModalBehavior";

// 식당이 많을 때(1000+건) 전부 DOM으로 그리면 무거워서 가상 스크롤(react-window)을 쓴다.
// 화면에 보이는 행만 DOM에 남는다. 행 높이는 고정이어야 하므로 아래 RestaurantRow와 같이 맞춘다.
const ROW_HEIGHT = 76;

// react-window는 고정 높이가 필요해서, 목록 영역이 실제로 차지하는 높이를 ResizeObserver로 잰다.
function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
}

interface RestaurantCandidate {
  title: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  distanceMeters: number;
}

interface RestaurantListProps {
  companyCode: string;
  restaurants: RestaurantSummary[]; // 필터 + 지도 화면 범위로 이미 걸러진 목록
  hasAnyRestaurants: boolean; // 필터와 무관하게 이 회사에 식당 데이터가 하나라도 있는지
  // 필터 조건에는 맞지만 지금 지도 화면 밖이라 안 보이는 식당이 있는지 (빈 목록 안내 문구 구분용)
  hasRestaurantsOutOfView?: boolean;
  // 필터가 하나라도 켜져 있으면 빈 목록 안내에 "필터 해제" 버튼을 보여준다.
  onClearFilters?: () => void;
  favoriteIds: Set<string>;
  onToggleFavorite: (restaurant: RestaurantSummary) => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
  onAddRestaurant?: (restaurant: RestaurantSummary) => void;
  onNotify?: (message: string) => void;
  unreadNotifCount?: number;
  onOpenNotifications?: () => void;
  onOpenFriends?: () => void;
  // "같이 정하기" 메뉴 항목들 (실제 모달은 CompanyHome이 들고 있다)
  onOpenVote?: () => void;
  onOpenBattle?: () => void;
  onOpenRecommend?: () => void;
  onOpenMiniGame?: () => void;
  onOpenSearch?: () => void;
  // 지도에서 클러스터를 눌러 구역 확대 상태일 때 그 구역 식당 수 (아니면 null)
  clusterFilterCount?: number | null;
  onClearClusterFilter?: () => void;
  userMenu?: ReactNode;
  // 모바일 "캘린더" 탭 내용. 데스크톱은 CompanyHome이 별도 카드(CalendarPanel)로 그리고 여기엔 null.
  mealLogSection?: ReactNode;
}

// 이보다 멀면 후보 목록에 "회사에서 멀어요" 배지를 표시한다 (자동으로 거르지는 않음).
const FAR_AWAY_METERS = 5000;

// 회사 직원식당 메뉴 페이지. 네이버 쪽에서 매주 내용이 바뀌는 고정 링크라 그대로 둔다 (사용자 확인, 2026-11-23).
const EMPLOYEE_CAFETERIA_MENU_URL = "https://m.site.naver.com/24Lw0";

function formatWalking(r: RestaurantSummary): string | null {
  if (r.walkingMinutes) return `도보 ${r.walkingMinutes}분`;
  if (typeof r.distanceMeters === "number") return `${Math.round(r.distanceMeters * 1.35)}m`;
  return null;
}

interface RestaurantRowData {
  restaurants: RestaurantSummary[];
  favoriteIds: Set<string>;
  onToggleFavorite: (restaurant: RestaurantSummary) => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
}

// 목록 한 줄. 고정 높이(ROW_HEIGHT) 안에 들어가야 해서 이름 한 줄 + 정보 한 줄로 고정한다.
// 주소는 상세 화면에서 본다.
function RestaurantRow({ index, style, data }: ListChildComponentProps<RestaurantRowData>) {
  const { restaurants, favoriteIds, onToggleFavorite, onFocusRestaurant, onSelectRestaurant } = data;
  const r = restaurants[index];
  const isFavorite = favoriteIds.has(r.id);
  const walking = formatWalking(r);

  return (
    <li style={style as CSSProperties} className="box-border py-1">
      <div className="flex h-full items-center gap-1 rounded-xl border border-black/5 pl-4 pr-1 transition hover:border-primary/40">
        <button
          type="button"
          className="min-w-0 flex-1 py-2 text-left"
          onClick={() => {
            onFocusRestaurant?.(r);
            onSelectRestaurant?.(r);
          }}
        >
          <p className="truncate font-semibold text-ink">{r.name}</p>
          <div className="mt-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-ink-soft">
            {r.category && <span className="shrink-0">{r.category}</span>}
            {r.category && walking && <span aria-hidden className="text-ink-soft/50">·</span>}
            {walking && <span className="shrink-0">{walking}</span>}
            {r.isZeroPay && (
              <span className="shrink-0 rounded-full bg-primary-light px-2 py-0.5 font-medium text-primary-dark">
                제로페이
              </span>
            )}
            {r.discountInfo?.benefit && (
              <span className="shrink-0 rounded-full bg-success-light px-2 py-0.5 font-medium text-success-dark">
                제휴할인
              </span>
            )}
            {r.isZeroPayNeedsReview && (
              <span className="shrink-0 rounded-full bg-warning-light px-2 py-0.5 font-medium text-warning-dark">
                결제 확인 필요
              </span>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onToggleFavorite(r)}
          aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          aria-pressed={isFavorite}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-surface-muted"
        >
          <Icon
            name="heart"
            filled={isFavorite}
            className={isFavorite ? "h-5 w-5 text-primary" : "h-5 w-5 text-ink-soft/50"}
          />
        </button>
      </div>
    </li>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  badge,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label} (안 읽은 알림 ${badge}개)` : label}
      title={label}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink transition hover:bg-black/[0.08]"
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

// "같이 정하기" 메뉴. 여럿이 점심을 정하는 기능들을 한 진입점으로 묶는다.
// 모바일은 아래에서 올라오는 시트, 데스크톱은 가운데 작은 창.
function TogetherSheet({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: { label: string; description: string; onClick?: () => void }[];
}) {
  useModalBehavior(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="같이 정하기"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm animate-fade-in rounded-t-2xl bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-soft md:rounded-2xl md:pb-2"
      >
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h3 className="text-base font-bold text-ink">같이 정하기</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-muted"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <ul>
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  item.onClick?.();
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{item.description}</span>
                </span>
                <Icon name="chevronDown" className="h-4 w-4 shrink-0 -rotate-90 text-ink-soft/60" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// "직접 추가"는 2단계다: 이름(+위치 힌트)으로 후보를 찾아 보여주고, 사용자가 고른 후보만 저장한다.
// 체인점 이름 자동 매칭이 자주 틀려서 사람이 주소를 보고 고르게 했다 (2026-08-06).
export default function RestaurantList({
  companyCode,
  restaurants,
  hasAnyRestaurants,
  hasRestaurantsOutOfView = false,
  onClearFilters,
  favoriteIds,
  onToggleFavorite,
  onFocusRestaurant,
  onSelectRestaurant,
  onAddRestaurant,
  onNotify,
  unreadNotifCount = 0,
  onOpenNotifications,
  onOpenFriends,
  onOpenVote,
  onOpenBattle,
  onOpenRecommend,
  onOpenSearch,
  onOpenMiniGame,
  clusterFilterCount = null,
  onClearClusterFilter,
  userMenu,
  mealLogSection,
}: RestaurantListProps) {
  const router = useRouter();
  // 모바일 전용 탭("주변 식당" / "캘린더"). 데스크톱은 캘린더가 별도 카드라 항상 목록.
  const [mobileTab, setMobileTab] = useState<"list" | "calendar">("list");
  const [showTogether, setShowTogether] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addAddressHint, setAddAddressHint] = useState("");
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RestaurantCandidate[] | null>(null);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    similarName: string;
    similarAddress: string;
    distanceMeters: number;
    similarity: number;
  } | null>(null);
  const [listContainerRef, listHeight] = useElementHeight<HTMLDivElement>();
  useModalBehavior(showAddModal, () => {
    if (addingIndex === null) resetAddFlow();
  });

  function resetAddFlow() {
    setShowAddModal(false);
    setAddName("");
    setAddAddressHint("");
    setSearchStatus("idle");
    setSearchError(null);
    setCandidates(null);
    setAddingIndex(null);
    setDuplicateWarning(null);
  }

  // 1단계: 이름(+위치 힌트)으로 후보 목록을 검색한다. 아직 아무것도 저장하지 않는다.
  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;

    setSearchStatus("loading");
    setSearchError(null);
    setCandidates(null);

    try {
      const res = await fetch("/api/restaurants/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          name: addName.trim(),
          addressHint: addAddressHint.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSearchStatus("error");
        setSearchError(data.error ?? "검색하지 못했어요.");
        return;
      }

      setSearchStatus("idle");
      setCandidates((data.candidates ?? []) as RestaurantCandidate[]);
    } catch {
      setSearchStatus("error");
      setSearchError("네트워크 오류로 검색하지 못했어요. 다시 시도해 주세요.");
    }
  }

  // 2단계: 사용자가 고른 후보를 저장한다.
  async function handlePickCandidate(candidate: RestaurantCandidate, index: number) {
    setAddingIndex(index);
    setSearchError(null);
    setDuplicateWarning(null);

    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, candidate }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSearchError(data.error ?? "식당을 추가하지 못했어요.");
        setAddingIndex(null);
        return;
      }

      const { restaurant, existing, duplicateWarning: warn } = data as {
        restaurant: RestaurantSummary;
        existing: boolean;
        duplicateWarning?: {
          similarRestaurant: { name: string; address: string; distanceMeters: number };
          similarity: number;
        };
      };

      if (existing) {
        resetAddFlow();
        onNotify?.(`"${restaurant.name}"은(는) 이미 목록에 있어요.`);
        onFocusRestaurant?.(restaurant);
        return;
      }

      // 신규 등록: 화면에 먼저 반영하고 서버 데이터는 뒤에서 다시 받는다.
      onAddRestaurant?.(restaurant);
      router.refresh();

      if (warn) {
        // 비슷한 가맹점이 이미 있으면 창을 닫지 않고 경고만 보여준다 (등록은 이미 끝남).
        setAddingIndex(null);
        setCandidates(null);
        setDuplicateWarning({
          similarName: warn.similarRestaurant.name,
          similarAddress: warn.similarRestaurant.address,
          distanceMeters: warn.similarRestaurant.distanceMeters,
          similarity: warn.similarity,
        });
        onFocusRestaurant?.(restaurant);
      } else {
        resetAddFlow();
        onNotify?.(`"${restaurant.name}"을(를) 추가했어요.`);
        onFocusRestaurant?.(restaurant);
      }
    } catch {
      setSearchError("네트워크 오류로 추가하지 못했어요. 다시 시도해 주세요.");
      setAddingIndex(null);
    }
  }

  const togetherItems = [
    { label: "같이 밥 먹을 사람 찾기", description: "방을 만들어 동료들과 실시간으로 메뉴를 고릅니다", onClick: onOpenBattle },
    { label: "점심 투표", description: "후보를 올리고 동료들과 투표합니다", onClick: onOpenVote },
    { label: "오늘 뭐 먹지?", description: "조건에 맞는 식당을 무작위로 골라 줍니다", onClick: onOpenRecommend },
    { label: "미니게임", description: "사다리타기, 제비뽑기, 룰렛, 팀 나누기", onClick: onOpenMiniGame },
  ];

  // 제목 자리: 데스크톱은 "주변 식당", 모바일은 목록/캘린더 탭.
  const titleNode = (
    <>
      <h2 className="hidden text-lg font-bold text-ink md:block">주변 식당</h2>
      <div className="flex rounded-full bg-surface-muted p-0.5 md:hidden" role="tablist" aria-label="보기 전환">
        {(
          [
            ["list", "주변 식당"],
            ["calendar", "캘린더"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mobileTab === key}
            onClick={() => setMobileTab(key)}
            className={[
              "rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
              mobileTab === key ? "bg-surface text-ink shadow-xs" : "text-ink-soft",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );

  const headerButtons = (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-muted px-3.5 text-sm text-ink-soft transition hover:bg-black/[0.08]"
        >
          <Icon name="search" className="h-4 w-4 shrink-0" />
          <span className="truncate">검색</span>
        </button>
        <button
          type="button"
          onClick={() => setShowTogether(true)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          <Icon name="users" className="h-4 w-4" />
          같이 정하기
        </button>
        <IconButton icon="bell" label="알림" onClick={onOpenNotifications} badge={unreadNotifCount} />
        <IconButton icon="userPlus" label="친구" onClick={onOpenFriends} />
      </div>

      {/* 목록 전용 줄 - 모바일 캘린더 탭에서는 숨긴다 */}
      <div
        className={[
          "mt-2 flex items-center justify-between gap-2 text-xs text-ink-soft",
          mobileTab === "calendar" ? "hidden md:flex" : "flex",
        ].join(" ")}
      >
        <span className="truncate">
          {typeof clusterFilterCount === "number" ? (
            <>
              선택한 구역 {clusterFilterCount}곳 ·{" "}
              <button type="button" onClick={onClearClusterFilter} className="font-semibold text-primary-dark">
                전체 보기
              </button>
            </>
          ) : (
            `지도 화면 안 ${restaurants.length}곳`
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <a
            href={EMPLOYEE_CAFETERIA_MENU_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 transition hover:text-ink"
          >
            직원식당 메뉴
            <Icon name="external" className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-0.5 transition hover:text-ink"
          >
            <Icon name="plus" className="h-3 w-3" />
            식당 추가
          </button>
        </span>
      </div>
    </>
  );

  return (
    <>
      <BottomSheet title={titleNode} titleRight={userMenu} header={headerButtons}>
        <div
          className={
            mobileTab === "list" ? "flex h-full flex-col" : "hidden md:flex md:h-full md:flex-col"
          }
        >
          {restaurants.length === 0 ? (
            <div className="mt-1 rounded-xl border border-black/5 p-4 text-sm text-ink-soft">
              {!hasAnyRestaurants ? (
                `${companyCode} 근처 식당 데이터가 아직 없어요. 관리자에게 문의해 주세요.`
              ) : hasRestaurantsOutOfView ? (
                "지금 지도 화면 밖에 있어요. 지도를 옮기거나 축소해 보세요."
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span>이 조건에 맞는 식당이 없어요.</span>
                  {onClearFilters && (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      className="shrink-0 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/[0.08]"
                    >
                      필터 해제
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div ref={listContainerRef} className="min-h-0 flex-1">
              {listHeight > 0 && (
                <FixedSizeList
                  height={listHeight}
                  width="100%"
                  itemCount={restaurants.length}
                  itemSize={ROW_HEIGHT}
                  itemData={{ restaurants, favoriteIds, onToggleFavorite, onFocusRestaurant, onSelectRestaurant }}
                  innerElementType="ul"
                >
                  {RestaurantRow}
                </FixedSizeList>
              )}
            </div>
          )}
        </div>

        {/* 모바일 캘린더 탭 내용 (데스크톱은 CalendarPanel 카드가 대신한다) */}
        <div className={mobileTab === "calendar" ? "md:hidden" : "hidden"}>{mealLogSection}</div>
      </BottomSheet>

      <TogetherSheet open={showTogether} onClose={() => setShowTogether(false)} items={togetherItems} />

      {/* 식당 직접 추가 */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={resetAddFlow}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="식당 직접 추가"
            className="flex max-h-[85dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">식당 직접 추가</h3>
              <button
                type="button"
                onClick={resetAddFlow}
                aria-label="닫기"
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-muted"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="식당 이름"
                className="rounded-xl border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-primary"
                autoFocus
              />
              <input
                value={addAddressHint}
                onChange={(e) => setAddAddressHint(e.target.value)}
                placeholder="위치 힌트 (선택, 예: 신세계백화점 지하)"
                className="rounded-xl border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              {searchError && <p className="text-xs text-danger">{searchError}</p>}

              {duplicateWarning && (
                <div className="rounded-xl border border-warning/30 bg-warning-light p-3 text-xs text-warning-dark">
                  <p className="font-semibold">비슷한 가맹점이 이미 있어요</p>
                  <p className="mt-1">
                    <span className="font-medium">{duplicateWarning.similarName}</span> ({duplicateWarning.distanceMeters}m
                    거리, 이름 유사도 {Math.round(duplicateWarning.similarity * 100)}%)
                  </p>
                  <p className="mt-0.5 opacity-80">{duplicateWarning.similarAddress}</p>
                  <p className="mt-1.5">등록은 완료됐어요. 다른 곳이 맞다면 그대로 닫으면 됩니다.</p>
                  <button
                    type="button"
                    onClick={resetAddFlow}
                    className="mt-2 w-full rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-warning-dark transition hover:bg-white/70"
                  >
                    닫기
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={searchStatus === "loading"}
                  className="flex-1 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
                >
                  {searchStatus === "loading" ? "찾는 중..." : "찾아보기"}
                </button>
                <button
                  type="button"
                  onClick={resetAddFlow}
                  className="rounded-xl px-3 py-2.5 text-sm text-ink-soft hover:bg-surface-muted"
                >
                  취소
                </button>
              </div>
            </form>

            {candidates && (
              <div className="flex flex-col gap-2 border-t border-black/5 pt-2">
                {candidates.length === 0 ? (
                  <p className="text-xs text-ink-soft">검색 결과가 없어요. 이름이나 위치 힌트를 바꿔 보세요.</p>
                ) : (
                  <>
                    <p className="text-xs text-ink-soft">맞는 곳을 골라 주세요. 회사에서 가까운 순이에요.</p>
                    <ul className="flex flex-col gap-1.5">
                      {candidates.map((c, i) => (
                        <li key={`${c.title}-${c.address}`}>
                          <button
                            type="button"
                            disabled={addingIndex !== null}
                            onClick={() => handlePickCandidate(c, i)}
                            className="w-full rounded-xl border border-black/10 p-3 text-left text-sm transition hover:border-primary disabled:opacity-60"
                          >
                            <p className="font-medium text-ink">{c.title}</p>
                            <p className="text-xs text-ink-soft">{c.address}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-ink-soft">
                                {c.distanceMeters < 1000
                                  ? `${c.distanceMeters}m`
                                  : `${(c.distanceMeters / 1000).toFixed(1)}km`}
                              </span>
                              {c.category && (
                                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-ink-soft">{c.category}</span>
                              )}
                              {c.distanceMeters > FAR_AWAY_METERS && (
                                <span className="rounded-full bg-warning-light px-2 py-0.5 text-warning-dark">
                                  회사에서 멀어요
                                </span>
                              )}
                            </div>
                            {addingIndex === i && <p className="mt-1 text-xs text-primary">추가하는 중...</p>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {addingIndex !== null && <LoadingOverlay message="식당 정보를 불러와 등록하는 중..." />}
    </>
  );
}
