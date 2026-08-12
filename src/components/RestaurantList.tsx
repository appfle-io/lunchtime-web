"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import BottomSheet from "./BottomSheet";
import type { RestaurantSummary } from "@/types";

// 2026-08-06 밤 신규: 식당이 많을 때(공공데이터 시딩으로 1000+건) 전부 <li> DOM으로 그리면
// 초기 렌더/스크롤/리렌더가 무거워서 렉의 큰 부분을 차지했다. 지도 뷰포트 동기화(CompanyHome의
// listRestaurants)로 개수 자체를 줄인 것과는 별개로, 그래도 남는 목록을 "화면에 실제로 보이는
// 행만" DOM으로 유지하는 가상 스크롤(react-window)을 적용한다 - 목록이 몇 개든 실제 DOM 행 수는
// 항상 화면에 보이는 만큼(10~15개 수준)으로 고정된다.
const ROW_HEIGHT = 108; // 카드 한 줄 높이(px) - 아래 RestaurantRow와 반드시 같이 맞춰야 한다.

// react-window는 고정 높이가 필요해서, 부모(BottomSheet 스크롤 영역)가 실제로 차지하는 높이를
// ResizeObserver로 측정해 그대로 넘긴다. 높이가 0(아직 측정 전)이면 렌더를 건너뛴다.
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
  restaurants: RestaurantSummary[]; // FilterBar 조건 + 지도 뷰포트로 이미 걸러진 목록 (필터 UI는 여기 없음)
  hasAnyRestaurants: boolean; // 필터와 무관하게 이 회사에 식당 데이터가 하나라도 있는지
  // 2026-08-06 밤 신규: 카테고리/특수 필터 조건에는 맞지만 "지금 지도 화면 밖"이라 안 보이는
  // 식당이 있는지 - restaurants가 0개일 때 "필터에 안 맞음"과 "지도를 옮기면 있음"을 구분해서
  // 보여주기 위함(직방식 지도-리스트 동기화를 도입하면서 필요해진 구분).
  hasRestaurantsOutOfView?: boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (restaurant: RestaurantSummary) => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
  onNotify?: (message: string) => void;
  // 2026-08-06 신규: 알림/친구목록/투표 버튼 (BottomSheet header 슬롯에 같이 둔다)
  unreadNotifCount?: number;
  onOpenNotifications?: () => void;
  onOpenFriends?: () => void;
  onOpenVote?: () => void;
  // 2026-08-08 신규: "오늘 뭐 먹지?" 룰렛 버튼 (실제 모달/추천 로직은 CompanyHome이 들고 있는
  // LunchRouletteModal이 담당 - 다른 헤더 버튼들과 동일한 패턴).
  onOpenRecommend?: () => void;
  // 2026-08-08 신규: 돋보기(🔍) 검색 버튼 - 실제 검색 상태/모달은 CompanyHome이 들고 있는
  // RestaurantSearchModal이 담당(마찬가지로 다른 헤더 버튼들과 동일한 패턴).
  onOpenSearch?: () => void;
  // 2026-08-12 신규: "미니게임"(제비뽑기/룰렛/사다리타기/팀나누기) 버튼 - 실제 모달은
  // CompanyHome이 들고 있는 MiniGameModal이 담당(다른 헤더 버튼들과 동일한 패턴).
  onOpenMiniGame?: () => void;
  // 2026-08-06 오후 신규: 지도에서 클러스터를 클릭해 구역 확대 상태로 들어왔을 때(null이 아니면 숫자)
  // 리스트도 그 구역 식당만 보고 있다는 걸 배너로 바로 알려주기 위해.
  clusterFilterCount?: number | null;
  onClearClusterFilter?: () => void;
  // 2026-08-06 3차 신규: BottomSheet의 title("주변 식당") 줄 오른쪽 끝에 얹을 사용자 메뉴
  // (UserMenu - 닉네임 버튼 + 로그아웃/비밀번호 변경 드롭다운). 여기서는 그대로 전달만 한다.
  userMenu?: ReactNode;
  // 2026-08-06 심야 3번째 개편: "주변 식당 아래 빈 공간에 캘린더를 노출해달라"는 요청 -
  // 데스크톱은 CompanyHome.tsx가 CalendarPanel로 별도 카드를 그 여백에 띄우고, 이 prop은
  // "모바일 전용" 탭 콘텐츠로만 쓴다(모바일은 카드를 하나 더 띄울 공간이 없어서 이 바텀시트
  // 안에 "주변식당/캘린더" 탭으로 전환하는 방식 - 아래 mobileTab 참고). 데스크톱에서 렌더링될
  // 때는 CompanyHome이 null을 넘겨서 여기서 두 번째 MealLogCalendar 인스턴스가 마운트되지
  // 않게 한다(안 그러면 데스크톱 카드와 모바일 탭에서 동시에 fetch가 두 번 나간다).
  mealLogSection?: ReactNode;
}

// 이보다 멀면 후보 목록에 "회사에서 좀 멀어요" 배지를 표시한다. 자동으로 거부하지는 않음 -
// 사용자가 주소를 직접 보고 맞는지 최종 판단한다 (2026-08-06, 아래 큰 주석 참고).
const FAR_AWAY_METERS = 5000;

// 2026-08-11 신규: 회사 구내식당(직원식당)은 매주 갱신되는 네이버 페이지로만 존재해서(지도에
// 등록된 개별 식당이 아님), 지도 마커로 넣는 대신 리스트 상단에 바로가기 버튼만 연결한다(1단계 -
// 나중에 필요하면 지도 고정 핀/앱 내 메뉴 표시로 확장 가능, 프로젝트 문서 참고).
const EMPLOYEE_CAFETERIA_MENU_URL = "https://m.site.naver.com/24Lw0";

interface RestaurantRowData {
  restaurants: RestaurantSummary[];
  favoriteIds: Set<string>;
  onToggleFavorite: (restaurant: RestaurantSummary) => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
}

// 2026-08-06 밤 신규: react-window가 각 행을 그릴 때 쓰는 컴포넌트. 기존 <li> 카드와 최대한
// 똑같이 보이도록 하되, 고정 높이(ROW_HEIGHT) 안에 반드시 들어가야 해서 이름/주소는 한 줄로
// truncate하고 배지 줄은 줄바꿈 대신 한 줄로 고정했다 - 식당 이름이 아주 길면 예전보다 잘리는
// 부분이 늘 수 있다는 트레이드오프가 있다.
function RestaurantRow({ index, style, data }: ListChildComponentProps<RestaurantRowData>) {
  const { restaurants, favoriteIds, onToggleFavorite, onFocusRestaurant, onSelectRestaurant } = data;
  const r = restaurants[index];

  return (
    <li style={style as CSSProperties} className="box-border px-0 py-1">
      <div className="flex h-full flex-col justify-center rounded-xl2 border border-black/5 px-4 py-2 transition hover:border-primary/40">
        <div className="flex items-start justify-between gap-2">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => {
              onFocusRestaurant?.(r);
              onSelectRestaurant?.(r);
            }}
          >
            <p className="truncate font-semibold text-ink">{r.name}</p>
            <p className="truncate text-xs text-ink-soft">{r.address}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(r);
              }}
              aria-label={favoriteIds.has(r.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              className="rounded-full p-0.5 text-lg leading-none transition hover:bg-surface-muted"
            >
              {favoriteIds.has(r.id) ? "❤️" : "🤍"}
            </button>
            {typeof r.distanceMeters === "number" && (
              <span className="whitespace-nowrap text-xs text-ink-soft">{r.distanceMeters}m</span>
            )}
          </div>
        </div>
        <div
          className="mt-1.5 flex cursor-pointer gap-1.5 overflow-x-hidden"
          onClick={() => {
            onFocusRestaurant?.(r);
            onSelectRestaurant?.(r);
          }}
        >
          {r.category && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
              {r.category}
            </span>
          )}
          {r.discountInfo?.benefit && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              🏷️ 제휴할인
            </span>
          )}
          {r.isZeroPay && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary-dark">
              제로페이
            </span>
          )}
          {r.isZeroPayNeedsReview && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              ⚠️ 확인필요
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

// "오늘 뭐 먹지?" 버튼: 2026-08-08부터 실제로 동작함 - onOpenRecommend가 CompanyHome의
// LunchRouletteModal을 연다(다른 헤더 버튼들과 동일 패턴). 추천 후보 범위/Gemini 호출/랜덤 폴백
// 로직은 그 모달과 /api/recommend가 담당하고, 여기서는 버튼과 콜백 연결만 한다.
// TODO: 지도 마커 클릭 시 이 리스트에서 해당 항목 하이라이트/스크롤 (지금은 리스트 -> 지도 방향만 연결됨)
// 카테고리/제로페이/도보5분/즐겨찾기/회식/여름별미 필터 UI는 FilterBar(지도 위 상단 플로팅)로 옮겨졌다.
// 여기서는 이미 필터링된 restaurants를 받아서 렌더링만 한다 (2026-08-06).
//
// "직접 추가"는 2026-08-06에 2단계 방식으로 개편됨: 예전엔 이름(+위치힌트)만 넣으면 서버가
// 자동으로 후보 하나를 확정해서 바로 저장했는데, "궁중삼계탕"처럼 전국에 지점이 많은 체인 이름에서
// 자동 매칭이 반복적으로 실패/오매칭됐다(거리검증/정렬방식/랜드마크 앵커까지 다 시도해봤지만 계속 실패).
// 사용자 제안으로 "후보 목록(상호명+주소+거리)을 먼저 보여주고 사용자가 직접 고르게" 바꿈 - 사업자가
// 네이버에 업종을 다르게 등록해둔 경우(예: 실제 식당인데 카테고리가 "도소매")까지 사람이 눈으로 보고
// 걸러낼 수 있어서 자동 필터링보다 훨씬 확실하다.
//
// 2026-08-06 추가 개편: "오늘 뭐 먹지?"/"직접 추가하기" 버튼을 BottomSheet의 리스트 스크롤 영역
// 안에 그냥 같이 넣었더니, 목록을 보려고 스크롤하면 버튼이 같이 밀려 올라가고, 직접 추가 폼을
// 펼치면 그 폼이 목록 위 공간을 다 차지해서 목록을 보려면 폼까지 스크롤해서 지나쳐야 했다
// ("스크롤 압박이 심하다"는 사용자 피드백). 그래서 (1) 두 버튼은 BottomSheet의 header 슬롯으로
// 옮겨서 항상 같은 자리에 고정시키고, (2) "직접 추가" 폼 자체는 리스트 안에 펼쳐지는 대신
// 화면 중앙에 뜨는 모달로 분리했다 - 리스트 스크롤 공간을 전혀 잡아먹지 않는다.
export default function RestaurantList({
  companyCode,
  restaurants,
  hasAnyRestaurants,
  hasRestaurantsOutOfView = false,
  favoriteIds,
  onToggleFavorite,
  onFocusRestaurant,
  onSelectRestaurant,
  onNotify,
  unreadNotifCount = 0,
  onOpenNotifications,
  onOpenFriends,
  onOpenVote,
  onOpenRecommend,
  onOpenSearch,
  onOpenMiniGame,
  clusterFilterCount = null,
  onClearClusterFilter,
  userMenu,
  mealLogSection,
}: RestaurantListProps) {
  const router = useRouter();
  // 2026-08-06 심야: 모바일에서만 쓰는 탭 상태("주변식당" vs "캘린더"). 데스크톱은 탭 UI 자체를
  // md:hidden으로 숨기고 항상 목록을 보여주므로(캘린더는 CalendarPanel이라는 별도 카드로 보여줌),
  // 이 상태 값은 모바일 화면에서만 실제로 의미를 가진다.
  const [mobileTab, setMobileTab] = useState<"list" | "calendar">("list");
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
  // 가상 스크롤(react-window)에 넘길 높이 - 이 목록이 실제로 차지하는 픽셀 높이를 측정해야 한다.
  const [listContainerRef, listHeight] = useElementHeight<HTMLDivElement>();

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
      setSearchError("네트워크 오류로 검색하지 못했어요. 다시 시도해줘.");
    }
  }

  // 2단계: 사용자가 후보 목록 중 하나를 클릭하면 그 후보를 그대로 저장한다.
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
        // 완전히 같은 식당(같은 id) - 모달 닫고 토스트
        resetAddFlow();
        onNotify?.(`"${restaurant.name}"은 이미 목록에 있어요.`);
        onFocusRestaurant?.(restaurant);
        return;
      }

      // 신규 등록 성공
      router.refresh();

      if (warn) {
        // 중복 경고: 모달은 닫지 않고 경고 배너만 표시 (사용자가 직접 확인 후 닫기)
        setAddingIndex(null);
        setCandidates(null);
        setDuplicateWarning({
          similarName: warn.similarRestaurant.name,
          similarAddress: warn.similarRestaurant.address,
          distanceMeters: warn.similarRestaurant.distanceMeters,
          similarity: warn.similarity,
        });
        // 지도는 이미 추가된 곳으로 이동
        onFocusRestaurant?.(restaurant);
      } else {
        // 깔끔한 신규 등록
        resetAddFlow();
        onNotify?.(`"${restaurant.name}"을 추가했어요. 제로페이 여부는 잠시 후 자동으로 확인돼요. ⏳`);
        onFocusRestaurant?.(restaurant);
      }
    } catch {
      setSearchError("네트워크 오류로 추가하지 못했어요. 다시 시도해줘.");
      setAddingIndex(null);
    }
  }

  const headerButtons = (
    <>
      {/* 2026-08-06 신규: 알림/친구목록/투표 버튼. 다른 절대위치 버튼처럼 화면 좌표를 새로 잡지 않고,
          항상 안전한 이 header 슬롯에 같이 둔다(레이아웃 회귀를 또 만들지 않기 위함). */}
      <div className="mb-2 flex gap-1.5">
        <button
          onClick={onOpenSearch}
          aria-label="가맹점 검색"
          className="flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          🔍
        </button>
        <button
          onClick={onOpenNotifications}
          aria-label="알림"
          className="relative flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          🔔
          {unreadNotifCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {unreadNotifCount}
            </span>
          )}
        </button>
        <button
          onClick={onOpenFriends}
          className="flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          친구
        </button>
        <button
          onClick={onOpenVote}
          className="flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          투표
        </button>
      </div>

      {/* 2026-08-06 심야 신규: 모바일 전용 탭 전환("주변식당" / "캘린더"). 데스크톱은 캘린더가
          CalendarPanel이라는 별도 카드로 항상 보이니 탭 자체가 필요 없어서 md:hidden으로 숨긴다. */}
      <div className="mb-2 flex gap-1 rounded-xl2 bg-surface-muted p-1 md:hidden">
        <button
          onClick={() => setMobileTab("list")}
          className={[
            "flex-1 rounded-lg py-1.5 text-xs font-semibold transition",
            mobileTab === "list" ? "bg-surface text-ink shadow-soft" : "text-ink-soft",
          ].join(" ")}
        >
          주변식당
        </button>
        <button
          onClick={() => setMobileTab("calendar")}
          className={[
            "flex-1 rounded-lg py-1.5 text-xs font-semibold transition",
            mobileTab === "calendar" ? "bg-surface text-ink shadow-soft" : "text-ink-soft",
          ].join(" ")}
        >
          캘린더
        </button>
      </div>

      {/* "오늘 뭐 먹지?"/"직접 추가"는 목록 전용 액션이라, 모바일에서 캘린더 탭을 보고 있을 때는
          숨긴다. 데스크톱은 탭 상태와 무관하게 항상 목록 카드이므로 md:block으로 다시 보이게 한다. */}
      <div className={mobileTab === "calendar" ? "hidden md:block" : ""}>
        <button
          onClick={onOpenRecommend}
          className="mb-2 w-full rounded-xl2 bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black"
        >
          🎲 오늘 뭐 먹지?
        </button>
        {/* 2026-08-12 신규: 미니게임(제비뽑기/룰렛/사다리타기/팀나누기) - 점심 먹고 후식 내기
            등으로 쓰라고 추가. "오늘 뭐 먹지?"와 나란히 눈에 잘 띄게 배치. */}
        <button
          onClick={onOpenMiniGame}
          className="mb-2 w-full rounded-xl2 border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-primary hover:text-primary"
        >
          미니게임
        </button>
        {/* 2026-08-11 신규: 구내식당(직원식당) 매주 메뉴표로 바로가는 링크. 새로운 탭으로 열어서
            앱 내부 네비게이션을 뜨지 않는다. */}
        <a
          href={EMPLOYEE_CAFETERIA_MENU_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl2 border border-black/10 px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-primary hover:text-primary"
        >
          이번주 직원식당 메뉴
        </a>
        <button
          onClick={() => setShowAddModal(true)}
          className="mb-1 w-full rounded-xl2 border border-dashed border-black/15 px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-primary hover:text-primary"
        >
          + 여기 없는 식당 직접 추가하기
        </button>
      </div>
    </>
  );

  return (
    <>
      <BottomSheet title="주변 식당" titleRight={userMenu} header={headerButtons}>
        {/* 주변식당 목록 - 데스크톱은 탭 상태와 무관하게 항상 보인다. 모바일은 mobileTab==='list'일
            때만 보인다. 2026-08-06 밤: 가상 스크롤(react-window)이 실제 남은 높이를 알아야 해서
            h-full + flex-col 레이아웃으로 바꾸고, 목록 부분만 flex-1 min-h-0으로 감쌌다. */}
        <div
          className={
            mobileTab === "list" ? "flex h-full flex-col" : "hidden md:flex md:h-full md:flex-col"
          }
        >
          {typeof clusterFilterCount === "number" && (
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2 rounded-xl2 bg-primary-light px-3 py-2 text-xs text-primary-dark">
              <span>📍 지도에서 선택한 구역 식당만 보는 중 ({clusterFilterCount}개)</span>
              <button
                onClick={onClearClusterFilter}
                className="shrink-0 rounded-full bg-surface px-2.5 py-1 font-semibold transition hover:bg-white"
              >
                전체보기
              </button>
            </div>
          )}
          {restaurants.length === 0 ? (
            <div className="mb-4 rounded-xl2 border border-black/5 p-4 text-sm text-ink-soft">
              {!hasAnyRestaurants
                ? `${companyCode} 근처 식당 데이터가 아직 없어요. 관리자 시딩이 필요합니다.`
                : hasRestaurantsOutOfView
                  ? "지금 지도 화면 밖에 있어요. 지도를 움직이거나 축소해보세요."
                  : "이 필터 조건에 맞는 식당이 없어요."}
            </div>
          ) : (
            <div ref={listContainerRef} className="mb-4 min-h-0 flex-1">
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

        {/* 2026-08-06 심야 3번째 개편: 밥 먹은 기록(캘린더뷰) - 모바일 전용 탭 콘텐츠.
            mobileTab==='calendar'일 때만 보이고, 데스크톱에서는 이 자리 대신 CalendarPanel(별도
            카드)에서 보여주므로 여기는 항상 숨긴다(md:hidden). 데스크톱일 때는 CompanyHome이
            mealLogSection 자체를 null로 넘겨서 중복 마운트/중복 fetch를 막는다. */}
        <div className={mobileTab === "calendar" ? "md:hidden" : "hidden"}>{mealLogSection}</div>
      </BottomSheet>

      {/* "직접 추가" 모달. BottomSheet 바깥의 독립된 오버레이라 리스트 스크롤과 완전히 분리됨. */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={resetAddFlow}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">식당 직접 추가</h3>
              <button
                type="button"
                onClick={resetAddFlow}
                aria-label="닫기"
                className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="식당 이름 (예: 영등포신세계 OO식당)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
                autoFocus
              />
              <input
                value={addAddressHint}
                onChange={(e) => setAddAddressHint(e.target.value)}
                placeholder="위치 힌트 (선택, 예: 영등포시장역 / 신세계백화점 영등포점 지하)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {searchError && <p className="text-xs text-primary-dark">{searchError}</p>}

              {/* 중복 경고 배너 - 등록은 완료됐지만 비슷한 가맹점이 이미 있을 때 표시 */}
              {duplicateWarning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-amber-700">⚠️ 비슷한 가맹점이 이미 있어요</p>
                  <p className="text-xs text-amber-700">
                    <span className="font-medium">{duplicateWarning.similarName}</span>
                    {" — "}
                    {duplicateWarning.distanceMeters}m 거리에 유사도 {Math.round(duplicateWarning.similarity * 100)}% 가맹점이 등록돼 있어요.
                  </p>
                  <p className="mt-1 text-[11px] text-amber-600">{duplicateWarning.similarAddress}</p>
                  <p className="mt-1.5 text-[11px] text-amber-600">등록은 완료됐어요. 실제로 다른 곳이라면 그냥 닫아주세요.</p>
                  <button
                    type="button"
                    onClick={resetAddFlow}
                    className="mt-2 w-full rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
                  >
                    확인했어요, 닫기
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={searchStatus === "loading"}
                  className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
                >
                  {searchStatus === "loading" ? "찾는 중..." : "찾아보기"}
                </button>
                <button
                  type="button"
                  onClick={resetAddFlow}
                  className="rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted"
                >
                  취소
                </button>
              </div>
            </form>

            {candidates && (
              <div className="flex flex-col gap-2 border-t border-black/5 pt-2">
                {candidates.length === 0 ? (
                  <p className="text-xs text-ink-soft">
                    검색 결과가 없어요. 상호명이나 위치 힌트를 다시 확인해서 시도해주세요.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-ink-soft">
                      이 중에 맞는 곳을 골라주세요 (회사에서 가까운 순, 카테고리가 이상해도 실제로 맞으면 골라도 돼요):
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {candidates.map((c, i) => (
                        <li key={`${c.title}-${c.address}`}>
                          <button
                            type="button"
                            disabled={addingIndex !== null}
                            onClick={() => handlePickCandidate(c, i)}
                            className="w-full rounded-xl border border-black/10 p-2.5 text-left text-sm transition hover:border-primary disabled:opacity-60"
                          >
                            <p className="font-medium text-ink">{c.title}</p>
                            <p className="text-xs text-ink-soft">{c.address}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-soft">
                                {c.distanceMeters < 1000
                                  ? `${c.distanceMeters}m`
                                  : `${(c.distanceMeters / 1000).toFixed(1)}km`}
                              </span>
                              {c.category && (
                                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-soft">
                                  {c.category}
                                </span>
                              )}
                              {c.distanceMeters > FAR_AWAY_METERS && (
                                <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] text-primary-dark">
                                  회사에서 좀 멀어요
                                </span>
                              )}
                            </div>
                            {addingIndex === i && (
                              <p className="mt-1 text-[11px] text-primary">추가하는 중...</p>
                            )}
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
    </>
  );
}
