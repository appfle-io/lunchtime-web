"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MapView from "./MapView";
import RestaurantList from "./RestaurantList";
import RestaurantDetail from "./RestaurantDetail";
import FilterBar from "./FilterBar";
import PopularWidget from "./PopularWidget";
import WeatherWidget from "./WeatherWidget";
import FriendsModal from "./FriendsModal";
import NotificationsModal, { type NotificationEntry } from "./NotificationsModal";
import LunchVoteModal from "./LunchVoteModal";
import LunchRouletteModal from "./LunchRouletteModal";
import RestaurantSearchModal from "./RestaurantSearchModal";
import UserMenu from "./UserMenu";
import PinResetModal from "./PinResetModal";
import MealLogCalendar from "./MealLogCalendar";
import CalendarPanel from "./CalendarPanel";
import Toast from "./Toast";
import LoadingOverlay from "./LoadingOverlay";
import type { RestaurantSummary } from "@/types";
import { filterRestaurants, type SpecialFilterKey } from "@/lib/restaurant-filters";
import { logRestaurantClick } from "@/lib/analytics-client";
import type { PopularEntry } from "@/lib/popular-server";
import type { ZeroPayStatus } from "@/lib/zeropay-server";
import type { CompanyUserEntry } from "@/lib/user-server";
import type { CurrentWeather } from "@/lib/weather";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";

// 인기 Top3(위젯)과 "최근많이찾는" 필터 태그가 같은 데이터를 쓰므로, top10 정도를 한 번만 받아와서
// 위젯은 앞 3개만 자르고 필터 태그는 id Set으로 전체를 쓴다.
const POPULAR_FETCH_LIMIT = 10;

// 2026-08-06: "10분마다 무조건 다시 읍기(setInterval)" 방식을 버렸다. 탭을 켜두기만 해도(클릭이 없어도)
// 하루 내내, 심지어 방치된 밤사이에도 계속 Firestore를 읍는 게 문제였음(방치 탭이 밤새 폴링해서
// 읍기가 급증한 사례 있음). 지금은 로그인/페이지 진입 시 1회 + 아래 업무시간 정각에만 자동으로 다시
// 읍고, 그 외엔 사용자가 새로고침 버튼을 누르거나 브라우저를 새로고침(F5 → 리마운트)했을 때만 다시 읍는다.
const POPULAR_AUTO_REFRESH_HOURS = [9, 10, 11, 12, 13, 14, 15]; // 로컬 시각 기준 정각(시 단위)
const POPULAR_SCHEDULE_CHECK_MS = 60 * 1000; // 정각 도달 여부만 확인하는 타이머 - 네트워크 요청 아님

// 2026-08-11 신규(페이지 로드 캐싱 2차 개선): companyUsers/popular는 페이지 진입(마운트)마다
// 캐시 없이 매번 새로 fetch하고 있었다(어제 firestore 과잉사용 분석에서 발견). 서버 쪽에도
// TTL 캐시를 추가했지만(user-server.ts/popular-server.ts), 같은 탭에서 F5로 반복 새로고침하는
// 경우엔 sessionStorage에 저장해두고 TTL 안이면 fetch 자체를 안 보내는 게 더 확실하게 아낀다 -
// 서버 캐시는 "네트워크는 타지만 Firestore는 안 읍는" 정도고, 이건 "네트워크 요청 자체를 스킵".
const COMPANY_USERS_CACHE_TTL_MS = 5 * 60 * 1000; // 5분 - 사용자 목록은 가입 시에만 바뀌는 데이터
const POPULAR_CACHE_TTL_MS = 60 * 1000; // 1분 - 인기 순위는 이 정도 지연은 체감상 문제없음

// 2026-08-12 신규(날씨 위젯): 기상청 초단기실황은 매시간 정시에만 갱신되는 데이터라, 서버쪽
// weather-server.ts에도 20분 TTL 캐시가 있지만(회사당 공용 캐시), 같은 탭에서 F5로 반복
// 새로고침할 때 네트워크 요청 자체를 스킵하기 위해 companyUsers/popular와 동일하게 sessionStorage
// 캐시도 같이 둔다.
const WEATHER_CACHE_TTL_MS = 20 * 60 * 1000;

// Tailwind의 md 브레이크포인트(768px)와 맞춘 값. 캘린더뷰를 데스크톱에서는 "주변 식당" 카드
// 아래 빈 공간에 별도 카드(CalendarPanel)로 띄우고, 모바일에서는 RestaurantList 안의
// "주변식당/캘린더" 탭으로 전환해서 보여주는데, 이 두 모드 중 하나만 MealLogCalendar를
// 마운트해야 같은 데이터를 두 번 fetch하지 않는다. CSS만으로는 "어디에 마운트할지"까지는
// 못 정하므로(mediaquery는 보이기/숨기기만 함) 여기서 JS로 판단한다.
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    setIsDesktop(mql.matches);

    const handleChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return isDesktop;
}

interface CompanyHomeProps {
  companyCode: string;
  centerLat?: number;
  centerLng?: number;
  restaurants: RestaurantSummary[];
  nickname: string;
  initialFavoriteIds: string[];
  // 2026-08-09 신규: 관리자면 닉네임 드롭다운에 "관리자 페이지" 링크를 보여준다.
  isAdmin: boolean;
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
  isAdmin,
}: CompanyHomeProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  // 2026-08-10 신규: "관리자 페이지" 클릭 시 router.push가 새 화면을 다 불러올 때까지 아무 반응이
  // 없어 보이던 문제 - useTransition으로 감싸서 클릭 즉시 로딩 오버레이를 띄운다.
  const [isNavigatingToAdmin, startAdminTransition] = useTransition();
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantSummary | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // 2026-08-11 신규: 처음 로딩 시 전체 가맹점을 다 보여주면(특히 공공데이터로 시딩된 회사는 수가
  // 많아서) 지도/마커/리스트가 동시에 다 그려지며 초기 로딩이 무거워진다(사용자 지적). 기본값을
  // "제로페이" 필터가 켜져있는 상태로 바꿔서 처음에는 제로페이 가맹점만 보여주고, 그 이후에는
  // 기존 toggleSpecialFilter 로직을 그대로 써서 사용자가 자유롭게 켜고/끔고 할 수 있다(필터 상태가 바뀌면
  // 그 뒤로는 사용자 조작만 반영되고 자동으로 다시 켜지거나 꺼지지 않음 - 이 useState 초기값은 첫 마운트
  // 시점에만 적용되는 값이라서).
  const [activeSpecialFilters, setActiveSpecialFilters] = useState<Set<SpecialFilterKey>>(
    () => new Set(["zeropay"])
  );
  const [popularEntries, setPopularEntries] = useState<PopularEntry[]>([]);
  const [isRefreshingPopular, setIsRefreshingPopular] = useState(false);
  // 2026-08-12 신규: 회사 주변 날씨(기온+아이콘). 못 불러와도(키 미설정/기상청 API 실패 등)
  // null 그대로 두면 WeatherWidget이 조용히 안 보여준다 - 부가 기능이라 실패해도 지도/추천
  // 자체는 계속 동작해야 한다는 기존 원칙(popularEntries/companyUsers)과 동일하게 처리.
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  // 2026-08-12 신규: 날씨 위젯을 눌러서 수동으로 새로고침할 때 잠깐 보여줄 "새로고침 중" 상태
  // (PopularWidget의 isRefreshingPopular와 동일한 패턴).
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);

  // 2026-08-06 오후 신규: 지도에서 클러스터 마커를 클릭하면, 그 그룹에 속한 식당 id들을 여기 담아둔다.
  // null이면 "구역 확대" 상태가 아님(평소 상태). 이 값이 있으면 지도와 좌측 리스트 둘 다 이 id들로만
  // 좁혀서 보여주고, "홈으로" 버튼을 누르면(handleGoHome) null로 되돌린다.
  const [clusterFilterIds, setClusterFilterIds] = useState<Set<string> | null>(null);
  // MapView에게 "원래 중심/줌으로 돌아가라"고 신호를 보내는 카운터 - 값이 바뀔 때마다(0보다 크면) 실행됨.
  const [homeSignal, setHomeSignal] = useState(0);
  // 2026-08-08 신규: 지도가 지금 "홈"(회사 중심/기본 줌) 위치인지 여부 - MapView가 idle마다
  // 보고해준다. 필터바/클러스터 확대와 무관하게 사용자가 지도를 직접 조금만 움직여도 false로
  // 바뀌어서 "전체 지도로 돌아가기" 버튼을 띄우는 데 쓰인다(아래 homeButtonVisible 참고).
  const [isMapAtHome, setIsMapAtHome] = useState(true);

  // 2026-08-06 밤 신규: 직방/네이버부동산처럼 "지도에 보이는 것 = 리스트에 보이는 것"을 만들기
  // 위한 상태. MapView가 뷰포트 컬링을 계산할 때마다(지도를 드래그/줌해서 idle이 발생할 때마다)
  // 그 결과(현재 화면에 실제로 보이는 식당 id들)를 여기로 올려받는다. null이면 "제한 없음"
  // (지도가 아직 준비 안 됐거나, 클러스터를 클릭해서 그 그룹 전체를 보여줘야 하는 상태) - 이때는
  // 리스트도 지금까지처럼 mapAndListRestaurants를 그대로 보여준다. 식당이 많을 때(예: 1500건)
  // 이 동기화 덕분에 리스트에 실제로 그려지는 항목 수가 지도 화면에 보이는 만큼(보통 수십 개)으로
  // 줄어든다 - 렉의 상당 부분이 여기서 온다는 걸 확인했다(2026-08-06 저녁).
  const [mapVisibleIds, setMapVisibleIds] = useState<Set<string> | null>(null);

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

  // 2026-08-11 신규(firestore 과잉사용 분석 반영): 회사 전체 사용자 목록(/api/users)을 예전엔
  // FriendsModal/LunchVoteModal/LunchRouletteModal 세 모달이 각각 열릴 때마다 따로따로
  // 재조회했다 - 세 모달을 순서대로 열면 같은 목록을 3번 반복 조회하는 낭비였다. 이제
  // CompanyHome이 페이지 진입 시 1회만 불러와서 props로 세 모달에 공유한다.
  const [companyUsers, setCompanyUsers] = useState<CompanyUserEntry[]>([]);

  // 2026-08-06 신규: 알림/친구목록/투표 모달 상태.
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [friendsPrefillNickname, setFriendsPrefillNickname] = useState<string | null>(null);
  const [showVote, setShowVote] = useState(false);
  const [voteFocusId, setVoteFocusId] = useState<string | null>(null);
  // 2026-08-08 신규: "오늘 뭐 먹지?" 룰렛 모달 상태.
  const [showRecommend, setShowRecommend] = useState(false);
  // 2026-08-08 신규: 돋보기(🔍) 가맹점 검색 모달 상태.
  const [showSearch, setShowSearch] = useState(false);
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

  // 2026-08-11 신규: 회사 전체 사용자 목록도 페이지 진입 시 1회만 불러온다 - 이 값을
  // FriendsModal/LunchVoteModal/LunchRouletteModal이 props로 그대로 물려받는다(세 모달이 각자
  // 열 때마다 재조회하던 것을 없앰).
  // 2026-08-11 캐싱 2차 개선: sessionStorage에 캐시된 값이 TTL 안이면 fetch 자체를 스킵한다 -
  // 같은 탭에서 F5로 반복 새로고침해도 네트워크 요청이 안 나간다.
  useEffect(() => {
    const cacheKey = `lt:companyUsers:${companyCode}`;
    const cached = readSessionCache<CompanyUserEntry[]>(cacheKey, COMPANY_USERS_CACHE_TTL_MS);
    if (cached) {
      setCompanyUsers(cached);
      return;
    }

    fetch(`/api/users?companyCode=${encodeURIComponent(companyCode)}`)
      .then((res) => res.json())
      .then((data) => {
        const users = data.users ?? [];
        setCompanyUsers(users);
        writeSessionCache(cacheKey, users);
      })
      .catch(() => {
        // 회사 사용자 목록은 보조 정보라 실패해도 조용히 무시한다 - 이 값을 쓰는
        // 모달들은 빈 목록이라면 검색/빠른선택이 비어 보일 뿐이다.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCode]);

  // 2026-08-12 신규: 회사 주변 날씨도 companyUsers/popular와 같은 패턴 - 페이지 진입 시 1회만
  // 불러오고, sessionStorage 캐시(TTL 20분)가 있으면 fetch 자체를 스킵한다. 날씨는 회사 전체가
  // 같은 값을 보는 공용 정보라(개인화 없음) 로그인 여부와 무관하게 조회 가능한 /api/weather를
  // 그대로 쓴다.
  // 2026-08-12 추가: 위젯을 눌러서 수동으로 다시 불러올 수 있게 fetchPopular와 동일한 형태로
  // force 파라미터를 넣은 함수로 분리했다 - force=true면 sessionStorage 캐시를 건너뛰고 항상
  // 새로 불러온 뒤 캐시도 갱신한다(단, 서버 쪽 weather-server.ts의 20분 캐시는 그대로 적용되므로,
  // 마지막 실제 기상청 조회로부터 20분이 안 지났으면 같은 값이 그대로 돌아올 수 있다 - 어차피
  // 기상청 데이터 자체가 매시간 정시에만 바뀌는 값이라 문제되지 않는다).
  const weatherCacheKey = `lt:weather:${companyCode}`;
  const fetchWeather = useCallback(
    async (force = false) => {
      if (!force) {
        const cached = readSessionCache<CurrentWeather>(weatherCacheKey, WEATHER_CACHE_TTL_MS);
        if (cached) {
          setWeather(cached);
          return;
        }
      }

      try {
        const res = await fetch(`/api/weather?companyCode=${encodeURIComponent(companyCode)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { weather: CurrentWeather | null };
        if (data.weather) {
          setWeather(data.weather);
          writeSessionCache(weatherCacheKey, data.weather);
        }
      } catch {
        // 날씨 위젯은 부가 기능이라 실패해도 조용히 무시한다 - null 상태 그대로 위젯이 안 보일 뿐.
      }
    },
    [companyCode, weatherCacheKey]
  );

  // 위젯 클릭 시 - 버튼에 "새로고침 중" 표시를 잠깐 보여주기 위해 fetchWeather를 감싼다
  // (handleManualPopularRefresh와 동일한 패턴).
  const handleManualWeatherRefresh = useCallback(async () => {
    setIsRefreshingWeather(true);
    await fetchWeather(true);
    setIsRefreshingWeather(false);
  }, [fetchWeather]);

  useEffect(() => {
    fetchWeather(); // 로그인/페이지 진입 시(또는 F5로 이 컴포넌트가 다시 마운트될 때) 1회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCode]);

  // 실시간 인기 Top3 (2026-08-06 신규, 2026-08-06 갱신주기 변경): 위젯 노출용 top3와 "최근많이찾는"
  // 필터 태그용 id Set이 같은 응답을 공유한다.
  // 2026-08-11 캐싱 2차 개선: force가 아니면 sessionStorage 캐시가 TTL 안일 때 fetch를 스킵한다.
  // 수동 새로고침 버튼(handleManualPopularRefresh)과 업무시간 정각 자동 갱신은 "지금 최신값을
  // 봐야 하는" 상황이라 force=true로 캐시를 건너뛰고 항상 새로 불러온 뒤 캐시도 갱신한다.
  const popularCacheKey = `lt:popular:${companyCode}`;
  const fetchPopular = useCallback(
    async (force = false) => {
      if (!force) {
        const cached = readSessionCache<PopularEntry[]>(popularCacheKey, POPULAR_CACHE_TTL_MS);
        if (cached) {
          setPopularEntries(cached);
          return;
        }
      }

      try {
        const res = await fetch(
          `/api/popular?companyCode=${encodeURIComponent(companyCode)}&limit=${POPULAR_FETCH_LIMIT}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { entries: PopularEntry[] };
        const entries = data.entries ?? [];
        setPopularEntries(entries);
        writeSessionCache(popularCacheKey, entries);
      } catch {
        // 인기 위젯은 부가 기능이라 실패해도 조용히 무시한다.
      }
    },
    [companyCode, popularCacheKey]
  );

  // 새로고침 버튼 클릭 시 - 버튼에 "새로고침 중" 표시를 잠깐 보여주기 위해 fetchPopular를 감싼다.
  // 사용자가 명시적으로 누른 새로고침이니 force=true로 캐시를 건너뛰고 항상 새로 불러온다.
  const handleManualPopularRefresh = useCallback(async () => {
    setIsRefreshingPopular(true);
    await fetchPopular(true);
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
      fetchPopular(true); // 정각 자동 갱신은 캐시 여부와 무관하게 항상 최신값을 받아온다
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

  // 2026-08-06 밤 신규: 왼쪽 "주변 식당" 리스트는 mapAndListRestaurants 전체가 아니라, 그중에서도
  // 지도에 지금 실제로 보이는(mapVisibleIds) 것만 보여준다 - 직방 방식. mapVisibleIds가 null이면
  // (지도가 아직 준비 안 됐거나 클러스터 확대 상태라 제한이 없는 경우) 지금까지처럼 전체를 보여준다.
  const listRestaurants = useMemo(() => {
    if (!mapVisibleIds) return mapAndListRestaurants;
    return mapAndListRestaurants.filter((r) => mapVisibleIds.has(r.id));
  }, [mapAndListRestaurants, mapVisibleIds]);

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

  // "홈으로" 버튼 - 클러스터 확대 상태를 풀고, 포커스된(확대 표시 중인) 가맹점도 해제하고,
  // 지도도 원래 중심/줌으로 되돌린다. 2026-08-08: 포커스 확대 마커를 자동으로(타이머 등으로)
  // 되돌리는 대신, 이 버튼을 눌러야만 원상태로 돌아가는 방식을 택함 - 사용자가 명시적으로
  // "이제 다 보고 싶다"고 할 때만 초기화되는 게 더 직관적이라고 판단.
  function handleGoHome() {
    setClusterFilterIds(null);
    setFocusTarget(null);
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
        onVisibleRestaurantsChange={setMapVisibleIds}
        onHomeStateChange={setIsMapAtHome}
      />

      <FilterBar
        restaurants={restaurants}
        activeCategory={activeCategory}
        activeSpecialFilters={activeSpecialFilters}
        onToggleCategory={toggleCategory}
        onToggleSpecialFilter={toggleSpecialFilter}
        homeButtonVisible={clusterFilterIds !== null || focusTarget !== null || !isMapAtHome}
        onGoHome={handleGoHome}
      />

      <WeatherWidget
        weather={weather}
        onRefresh={handleManualWeatherRefresh}
        isRefreshing={isRefreshingWeather}
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

      {/* 2026-08-07: 주변식당 카드 + 캘린더 카드를 데스크톱에서 하나의 flex 컬럼으로 묶는 wrapper.
          모바일에서는 display:contents로 아무 박스도 만들지 않아서(자식들이 각자의 절대좌표로
          기존처럼 동작), 데스크톱(md:)에서만 실제 flex 컨테이너가 되어 두 카드의 세로 공간을
          나눠 가진다 - 주변식당(BottomSheet, flex-1)이 남는 공간을 흡수하고 캘린더(CalendarPanel,
          shrink-0)는 내용 높이만큼만 차지해서, 예전처럼 캘린더 카드 안에 빈 여백이 남지 않는다. */}
      <div className="contents md:absolute md:inset-y-4 md:left-6 md:z-20 md:flex md:w-[400px] md:flex-col md:gap-4">
        <RestaurantList
          companyCode={companyCode}
          restaurants={listRestaurants}
          hasAnyRestaurants={restaurants.length > 0}
          hasRestaurantsOutOfView={listRestaurants.length === 0 && mapAndListRestaurants.length > 0}
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
          onOpenRecommend={() => setShowRecommend(true)}
          onOpenSearch={() => setShowSearch(true)}
          clusterFilterCount={clusterFilterIds ? clusterFilterIds.size : null}
          onClearClusterFilter={handleGoHome}
          userMenu={
            <UserMenu
              nickname={nickname}
              onLogout={handleLogout}
              onChangePassword={() => setShowPasswordChange(true)}
              isAdmin={isAdmin}
              onOpenAdmin={() => startAdminTransition(() => router.push(`/${companyCode}/admin`))}
            />
          }
          // 2026-08-06 심야 3번째 개편: 데스크톱에서는 MealLogCalendar를 아래 CalendarPanel(별도
          // 카드)에서만 마운트하고, 여기는 null을 넘겨 모바일 탭 쪽에서 중복 마운트되지 않게 한다.
          // 모바일(!isDesktop)일 때만 실제로 MealLogCalendar 인스턴스를 만들어 탭 콘텐츠로 넘긴다.
          mealLogSection={
            isDesktop ? null : (
              <MealLogCalendar
                companyCode={companyCode}
                restaurants={restaurants}
                onNotify={setToastMessage}
                refreshSignal={mealLogVersion}
              />
            )
          }
        />

        {/* 2026-08-06 심야 3번째 개편: "주변 식당" 카드 바로 아래 빈 공간에 캘린더를 별도 카드로
            노출해달라는 요청 - 데스크톱 전용(모바일은 위 RestaurantList의 탭으로 대체). */}
        {isDesktop && (
          <CalendarPanel>
            <MealLogCalendar
              companyCode={companyCode}
              restaurants={restaurants}
              onNotify={setToastMessage}
              refreshSignal={mealLogVersion}
            />
          </CalendarPanel>
        )}
      </div>

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
        companyUsers={companyUsers}
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
        companyUsers={companyUsers}
      />

      {/* 2026-08-08 신규: "오늘 뭐 먹지?" 룰렛. 2026-08-08 개편으로 이 모달이 반경/카테고리/
          제로페이 조건을 자체적으로 갖게 돼서, 메인 필터바 결과(visibleRestaurants)가 아니라
          회사 식당 전체(restaurants, 제로페이 실시간 갱신 포함)를 그대로 넘긴다 - 두 필터가
          겹쳐서 헷갈리는 걸 피하기 위함(자세한 이유는 LunchRouletteModal.tsx 주석 참고). */}
      <LunchRouletteModal
        open={showRecommend}
        companyCode={companyCode}
        allRestaurants={restaurants}
        onClose={() => setShowRecommend(false)}
        onFocusRestaurant={focusRestaurant}
        onSelectRestaurant={handleSelectRestaurant}
        companyUsers={companyUsers}
      />

      {/* 2026-08-08 신규: 돋보기(🔍) 가맹점 검색. 다른 모달들과 마찬가지로 회사 식당 전체(restaurants,
          필터바/클러스터/뷰포트가 적용되기 전 전체)를 대상으로 한다 - 지금 화면에 뭐가
          보이는지와 무관하게 회사에 등록된 모든 가맹점을 바로바로 찾을 수 있어야 한다. 결과를
          고르면 focusRestaurant/handleSelectRestaurant를 그대로 재사용해서(다른 포커스 이동
          경로와 동일) 상세모달 + MapView의 포커스 확대 로직까지 그대로 같이 적용된다. */}
      <RestaurantSearchModal
        open={showSearch}
        allRestaurants={restaurants}
        onClose={() => setShowSearch(false)}
        onFocusRestaurant={focusRestaurant}
        onSelectRestaurant={handleSelectRestaurant}
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
      {isNavigatingToAdmin && <LoadingOverlay message="관리자 페이지로 이동하는 중..." />}
    </main>
  );
}
