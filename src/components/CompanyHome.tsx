"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MapView from "./MapView";
import RestaurantList from "./RestaurantList";
import RestaurantDetail from "./RestaurantDetail";
import FilterBar from "./FilterBar";
import PopularWidget from "./PopularWidget";
import FriendsModal from "./FriendsModal";
import NotificationsModal, { type NotificationEntry } from "./NotificationsModal";
import LunchVoteModal from "./LunchVoteModal";
import UserMenu from "./UserMenu";
import PinResetModal from "./PinResetModal";
import MealLogCalendar from "./MealLogCalendar";
import Toast from "./Toast";
import type { RestaurantSummary } from "@/types";
import { filterRestaurants, type SpecialFilterKey } from "@/lib/restaurant-filters";
import { logRestaurantClick } from "@/lib/analytics-client";
import type { PopularEntry } from "@/lib/popular-server";
import type { ZeroPayStatus } from "@/lib/zeropay-server";

// 인기 Top3(위젯)과 "최근많이찾는" 필터 태그가 같은 데이터를 쓰므로, top10 정도를 한 번만 받아와서
// 위젯은 앞 3개만 자르고 필터 태그는 id Set으로 전체를 쓴다.
const POPULAR_FETCH_LIMIT = 10;

// 2026-08-06: "10분마다 무조건 다시 읍기(setInterval)" 방식을 버렸다. 탭을 켜두기만 해도(클릭이 없어도)
// 하루 내내, 심지어 방치된 밤사이에도 계속 Firestore를 읍는 게 문제였음(방치 탭이 밤새 폴링해서
// 읍기가 급증한 사례 있음). 지금은 로그인/페이지 진입 시 1회 + 아래 업무시간 정각에만 자동으로 다시
// 읍고, 그 외엔 사용자가 새로고침 버튼을 누르거나 브라우저를 새로고침(F5 → 리마운트)했을 때만 다시 읍는다.
const POPULAR_AUTO_REFRESH_HOURS = [9, 10, 11, 12, 13, 14, 15]; // 로컬 시각 기준 정각(시 단위)
const POPULAR_SCHEDULE_CHECK_MS = 60 * 1000; // 정각 도달 여부만 확인하는 타이머 - 네트워크 요청 아님

interface CompanyHomeProps {
  companyCode: string;
  centerLat?: number;
  centerLng?: number;
  restaurants: RestaurantSummary[];
  nickname: string;
  initialFavoriteIds: string[];
}

export interface FocusTarget {
  id: string;
  lat: number;
  lng: number;
}

// 지도(MapView)와 리스트(RestaurantList)는 형제 컴포넌트라 서로 직접 통신할 수 없다.
// 이 클라이언트 컴포넌트가 "지금 포커스해야 할 식당", "상세 모달로 열려있는 식당", "토스트 메시지",
// "즐겨찾기 목록", "필터 상태", "알림/친구/투표 모달", "클러스터 확대 상태"까지 들고 있으면서
// 지도/리스트/필터바/상세모달을 이어준다.
// (page.tsx는 async 서버 컴포넌트라 useState를 못 쓰기 때문에, 데이터 페칭/세션 체크는 page.tsx에서 하고
//  상태 관리는 이 컴포넌트로 넘겨받는 구조.)
export default function CompanyHome({
  companyCode,
  centerLat,
  centerLng,
  restaurants: initialRestaurants,
  nickname,
  initialFavoriteIds,
}: CompanyHomeProps) {
  const router = useRouter();
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantSummary | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeSpecialFilters, setActiveSpecialFilters] = useState<Set<SpecialFilterKey>>(
    () => new Set()
  );
  const [popularEntries, setPopularEntries] = useState<PopularEntry[]>([]);
  const [isRefreshingPopular, setIsRefreshingPopular] = useState(false);

  // 2026-08-06 오후 신규: 지도에서 클러스터 마커를 클릭하면, 그 그룹에 속한 식당 id들을 여기 담아둔다.
  // null이면 "구역 확대" 상태가 아님(평소 상태). 이 값이 있으면 지도와 좌측 리스트 둘 다 이 id들로만
  // 좁혀서 보여주고, "홈으로" 버튼을 누르면(handleGoHome) null로 되돌린다.
  const [clusterFilterIds, setClusterFilterIds] = useState<Set<string> | null>(null);
  // MapView에게 "원래 중심/줌으로 돌아가라"고 신호를 보내는 카운터 - 값이 바뀔 때마다(0보다 크면) 실행됨.
  const [homeSignal, setHomeSignal] = useState(0);

  // 2026-08-06 저녁 신규: 밥 먹은 기록(캘린더뷰)이 바뀌었다는 신호 카운터. 식당 상세모달의
  // "오늘 여기서 먹었어요" 버튼으로 기록을 추가/삭제하면, 주변식당 목록 아래에 이어져 있는
  // MealLogCalendar도 같은 값 변화를 보고 다시 불러온다(MapView의 homeSignal과 같은 패턴).
  const [mealLogVersion, setMealLogVersion] = useState(0);

  // 2026-08-06 신규: 제로페이 엄지척 투표 결과로 특정 식당의 isZeroPay/isZeroPayNeedsReview가
  // 바로바로 바뀔 수 있어서, restaurants를 prop 그대로 쓰지 않고 로컬 state로 복사해둔다
  // (favoriteIds와 동일한 패턴) - 상세모달에서 투표하면 페이지 새로고침 없이 지도 마커/리스트
  // 배지에도 즉시 반영된다.
  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>(initialRestaurants);

  // 2026-08-06 3차 버그 수정: "직접 추가"로 식당을 새로 저장하면(RestaurantList가 router.refresh()
  // 호출) page.tsx(서버 컴포넌트)가 restaurants를 다시 읽어서 새 initialRestaurants prop을
  // 내려주는데, 이 restaurants state는 useState(initialRestaurants)로 "처음 마운트할 때"만
  // 초기화되고 그 뒤로는 prop이 바뀌어도 React가 자동으로 반영해주지 않는다 - 그래서 검색/추가
  // API는 분명히 성공했는데도(Firestore에는 저장됐는데도) 화면에는 새 식당이 전혀 안 보이는
  // 버그가 있었다("직접 추가 클릭해도 실제로 추가 안 되는 것 같다" 피드백의 원인). initialRestaurants
  // 참조가 바뀔 때마다(=서버 컴포넌트가 다시 실행됐을 때만) 로컬 state에 다시 반영한다.
  useEffect(() => {
    setRestaurants(initialRestaurants);
  }, [initialRestaurants]);

  // 2026-08-06 신규: 알림/친구목록/투표 모달 상태.
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [friendsPrefillNickname, setFriendsPrefillNickname] = useState<string | null>(null);
  const [showVote, setShowVote] = useState(false);
  const [voteFocusId, setVoteFocusId] = useState<string | null>(null);
  // 2026-08-06 3차 신규: 닉네임 드롭다운의 "비밀번호 변경" 버튼을 눌렀을 때 띄우는 모달 상태.
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  const unreadNotifCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  function handleMealLogged() {
    setMealLogVersion((v) => v + 1);
  }

  function refreshNotifications() {
    fetch(`/api/notifications?companyCode=${encodeURIComponent(companyCode)}`)
      .then((res) => res.json())
      .then((data) => setNotifications(data.notifications ?? []))
      .catch(() => {
        // 알림함은 부가 기능이라 실패해도 조용히 무시한다.
      });
  }

  // 알림은 처음 진입 시 한 번 불러온다 (배지 카운트를 바로 보여주기 위함).
  useEffect(() => {
    refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCode]);

  // 실시간 인기 Top3 (2026-08-06 신규, 2026-08-06 갱신주기 변경): 위젯 노출용 top3와 "최근많이찾는"
  // 필터 태그용 id Set이 같은 응답을 공유한다.
  const fetchPopular = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/popular?companyCode=${encodeURIComponent(companyCode)}&limit=${POPULAR_FETCH_LIMIT}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { entries: PopularEntry[] };
      setPopularEntries(data.entries ?? []);
    } catch {
      // 인기 위젯은 부가 기능이라 실패해도 조용히 무시한다.
    }
  }, [companyCode]);

  // 새로고침 버튼 클릭 시 - 버튼에 "새로고침 중" 표시를 잠깐 보여주기 위해 fetchPopular를 감싼다.
  const handleManualPopularRefresh = useCallback(async () => {
    setIsRefreshingPopular(true);
    await fetchPopular();
    setIsRefreshingPopular(false);
  }, [fetchPopular]);

  useEffect(() => {
    fetchPopular(); // 로그인/페이지 진입 시(또는 F5로 이 컴포넌트가 다시 마운트될 때) 1회

    // 실제 네트워크 요청은 정각에만 나간다 - 이 타이머는 "지금이 그 정각인지"만 1분마다 가볍게 확인한다.
    // 방치된 탭은 POPULAR_AUTO_REFRESH_HOURS 시간대 외엔 어떤 요청도 만들지 않는다.
    let lastFetchedHourKey: string | null = null;
    const checkInterval = setInterval(() => {
      const now = new Date();
      if (now.getMinutes() !== 0 || !POPULAR_AUTO_REFRESH_HOURS.includes(now.getHours())) return;

      const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
      if (lastFetchedHourKey === hourKey) return; // 같은 정각에 중복 호출 방지
      lastFetchedHourKey = hourKey;
      fetchPopular();
    }, POPULAR_SCHEDULE_CHECK_MS);

    return () => clearInterval(checkInterval);
  }, [fetchPopular]);

  const popularIds = useMemo(
    () => new Set(popularEntries.map((e) => e.restaurantId)),
    [popularEntries]
  );

  // 지도/리스트에 실제로 보여줄, 필터 적용된 식당 목록. FilterBar의 카테고리 태그 자체는
  // (선택 가능한 옵션 목록을 안 줄어들게 유지하려고) 필터링 전 원본 restaurants 기준으로 뽑는다.
  const visibleRestaurants = useMemo(
    () => filterRestaurants(restaurants, activeCategory, activeSpecialFilters, favoriteIds, popularIds),
    [restaurants, activeCategory, activeSpecialFilters, favoriteIds, popularIds]
  );

  // 2026-08-06 오후 신규: 클러스터 확대 상태면(clusterFilterIds가 있으면) 지도와 좌측 리스트 둘 다
  // 그 그룹의 식당 id로 한 번 더 좁힌다. 클러스터 자체는 이미 visibleRestaurants(필터바 적용 후)
  // 기준으로 만들어졌으니, 여기서는 그 안에서 교집합만 취하면 된다.
  const mapAndListRestaurants = useMemo(() => {
    if (!clusterFilterIds) return visibleRestaurants;
    return visibleRestaurants.filter((r) => clusterFilterIds.has(r.id));
  }, [visibleRestaurants, clusterFilterIds]);

  function focusRestaurant(restaurant: RestaurantSummary) {
    if (typeof restaurant.lat !== "number" || typeof restaurant.lng !== "number") return;
    // 매번 새 객체를 만들어서, 같은 식당을 두 번 연속 눌러도 MapView의 effect가 다시 실행되게 한다.
    setFocusTarget({ id: restaurant.id, lat: restaurant.lat, lng: restaurant.lng });
  }

  // 마커 클릭/리스트 클릭으로 상세모달을 여는 진입점을 하나로 모아서, 여기서 클릭 통계도 같이 남긴다
  // (2026-08-06 신규 요청: 시간대별 클릭 통계 수집).
  // useCallback으로 감싸는 이유(2026-08-06 추가): 이 함수를 MapView에 onMarkerClick prop으로
  // 그대로 넘기는데, MapView는 이 prop의 참조가 바뀔 때마다 마커를 전부 지웠다가 다시 그린다.
  // 감싸지 않으면 popularEntries가 10분마다 갱신될 때처럼 이 컴포넌트가 리렌더될 때마다 매번 새
  // 함수가 만들어져서 불필요하게 전체 마커가 다시 그려졌다 - 식당이 많을 때 이런 불필요한
  // 재생성 자체가 렉의 또 다른 원인이 될 수 있어 방지한다.
  const handleSelectRestaurant = useCallback(
    (restaurant: RestaurantSummary) => {
      setSelectedRestaurant(restaurant);
      logRestaurantClick(companyCode, restaurant.id);
    },
    [companyCode]
  );

  // 2026-08-06 오후 신규: 지도에서 클러스터 마커를 클릭했을 때 - 그 그룹의 식당 id로 좁힌다.
  // MapView는 이 prop의 참조가 바뀔 때마다 마커 effect를 다시 돌리므로 useCallback으로 감싼다
  // (handleSelectRestaurant와 같은 이유).
  const handleClusterClick = useCallback((clusterRestaurants: RestaurantSummary[]) => {
    setClusterFilterIds(new Set(clusterRestaurants.map((r) => r.id)));
  }, []);

  // "홈으로" 버튼 - 클러스터 확대 상태를 풀고 지도도 원래 중심/줌으로 되돌린다.
  function handleGoHome() {
    setClusterFilterIds(null);
    setHomeSignal((v) => v + 1);
  }

  function toggleCategory(label: string) {
    setActiveCategory((prev) => (prev === label ? null : label));
  }

  function toggleSpecialFilter(key: SpecialFilterKey) {
    setActiveSpecialFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // 즐겨찾기는 서버 응답을 기다리지 않고 먼저 화면부터 바꾼 뒤(낙관적 업데이트), 실패하면 되돌린다.
  async function toggleFavorite(restaurant: RestaurantSummary) {
    const willFavorite = !favoriteIds.has(restaurant.id);

    setFavoriteIds((prev) => {
      const next = new Set(prev);
      willFavorite ? next.add(restaurant.id) : next.delete(restaurant.id);
      return next;
    });

    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, restaurantId: restaurant.id, isFavorite: willFavorite }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        willFavorite ? next.delete(restaurant.id) : next.add(restaurant.id);
        return next;
      });
      setToastMessage("즐겨찾기 변경에 실패했어요. 다시 시도해줘.");
    }
  }

  // 2026-08-06 신규: 상세모달에서 제로페이 엄지척/거꾸로엄지척 투표를 하면, 그 결과(effectiveIsZeroPay/
  // needsReview)를 지도 마커와 리스트 배지에도 바로 반영한다 - 새로고침 없이도 최신 상태로 보이게.
  function handleZeroPayStatusChange(restaurantId: string, status: ZeroPayStatus) {
    setRestaurants((prev) =>
      prev.map((r) =>
        r.id === restaurantId
          ? { ...r, isZeroPay: status.effectiveIsZeroPay, isZeroPayNeedsReview: status.needsReview }
          : r
      )
    );
  }

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.refresh();
  }

  // 알림 관련 핸들러들 (2026-08-06 신규)
  function openNotifications() {
    refreshNotifications();
    setShowNotifications(true);
  }

  async function markNotificationRead(notificationId: string) {
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, notificationId }),
      });
    } catch {
      // 읽음 처리 실패는 조용히 무시 - 다음에 다시 열면 여전히 안 읽음으로 보일 뿐, 치명적이지 않다.
    }
  }

  // 알림함의 "나도 추가하기" - 알림함을 닫고 그 닉네임이 미리 채워진 친구목록 모달을 연다.
  function handleAddBackFromNotification(nickname: string) {
    setShowNotifications(false);
    setFriendsPrefillNickname(nickname);
    setShowFriends(true);
  }

  // 알림함의 "투표하러 가기" - 알림함을 닫고 그 투표가 펼쳐진 투표 모달을 연다.
  function handleOpenVoteFromNotification(voteId: string) {
    setShowNotifications(false);
    setVoteFocusId(voteId);
    setShowVote(true);
  }

  return (
    <main className="relative h-screen w-full overflow-hidden">
      <MapView
        companyCode={companyCode}
        centerLat={centerLat}
        centerLng={centerLng}
        restaurants={mapAndListRestaurants}
        focusTarget={focusTarget}
        onMarkerClick={handleSelectRestaurant}
        onClusterClick={handleClusterClick}
        disableClustering={clusterFilterIds !== null}
        homeSignal={homeSignal}
      />

      <FilterBar
        restaurants={restaurants}
        activeCategory={activeCategory}
        activeSpecialFilters={activeSpecialFilters}
        onToggleCategory={toggleCategory}
        onToggleSpecialFilter={toggleSpecialFilter}
        homeButtonVisible={clusterFilterIds !== null}
        onGoHome={handleGoHome}
      />

      <PopularWidget
        entries={popularEntries.slice(0, 3)}
        restaurants={restaurants}
        onSelect={(restaurant) => {
          focusRestaurant(restaurant);
          handleSelectRestaurant(restaurant);
        }}
        onRefresh={handleManualPopularRefresh}
        isRefreshing={isRefreshingPopular}
      />

      <RestaurantList
        companyCode={companyCode}
        restaurants={mapAndListRestaurants}
        hasAnyRestaurants={restaurants.length > 0}
        favoriteIds={favoriteIds}
        onToggleFavorite={toggleFavorite}
        onFocusRestaurant={focusRestaurant}
        onSelectRestaurant={handleSelectRestaurant}
        onNotify={setToastMessage}
        unreadNotifCount={unreadNotifCount}
        onOpenNotifications={openNotifications}
        onOpenFriends={() => {
          setFriendsPrefillNickname(null);
          setShowFriends(true);
        }}
        onOpenVote={() => {
          setVoteFocusId(null);
          setShowVote(true);
        }}
        clusterFilterCount={clusterFilterIds ? clusterFilterIds.size : null}
        onClearClusterFilter={handleGoHome}
        userMenu={
          <UserMenu
            nickname={nickname}
            onLogout={handleLogout}
            onChangePassword={() => setShowPasswordChange(true)}
          />
        }
        mealLogSection={
          <div className="mt-2 border-t border-black/5 pt-4">
            <h3 className="mb-3 text-sm font-bold text-ink">📅 밥 먹은 기록</h3>
            <MealLogCalendar
              companyCode={companyCode}
              restaurants={restaurants}
              onNotify={setToastMessage}
              refreshSignal={mealLogVersion}
            />
          </div>
        }
      />

      <RestaurantDetail
        restaurant={selectedRestaurant}
        companyCode={companyCode}
        nickname={nickname}
        isFavorite={selectedRestaurant ? favoriteIds.has(selectedRestaurant.id) : false}
        onToggleFavorite={() => selectedRestaurant && toggleFavorite(selectedRestaurant)}
        onClose={() => setSelectedRestaurant(null)}
        onZeroPayStatusChange={handleZeroPayStatusChange}
        onNotify={setToastMessage}
        onMealLogged={handleMealLogged}
      />

      <FriendsModal
        companyCode={companyCode}
        open={showFriends}
        onClose={() => setShowFriends(false)}
        onNotify={setToastMessage}
        prefillNickname={friendsPrefillNickname}
      />

      <NotificationsModal
        open={showNotifications}
        notifications={notifications}
        onClose={() => setShowNotifications(false)}
        onMarkRead={markNotificationRead}
        onAddBack={handleAddBackFromNotification}
        onOpenVote={handleOpenVoteFromNotification}
      />

      <LunchVoteModal
        companyCode={companyCode}
        myNickname={nickname}
        restaurants={restaurants}
        open={showVote}
        onClose={() => setShowVote(false)}
        onNotify={setToastMessage}
        focusVoteId={voteFocusId}
      />

      <PinResetModal
        companyCode={companyCode}
        open={showPasswordChange}
        mode="change"
        fixedNickname={nickname}
        onClose={() => setShowPasswordChange(false)}
        onNotify={setToastMessage}
        onSuccess={() => setShowPasswordChange(false)}
      />

      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </main>
  );
}
