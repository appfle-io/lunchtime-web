"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RestaurantSummary } from "@/types";
import type { FocusTarget } from "./CompanyHome";
import { getCategoryVisual } from "@/lib/restaurant-category";

declare global {
  interface Window {
    naver: any;
    navermap_authFailure?: () => void;
  }
}

interface MapViewProps {
  companyCode: string;
  centerLat?: number;
  centerLng?: number;
  restaurants?: RestaurantSummary[];
  focusTarget?: FocusTarget | null;
  onMarkerClick?: (restaurant: RestaurantSummary) => void;
  // 2026-08-06 오후 추가: 클러스터 마커를 클릭했을 때 그 그룹에 속한 식당 전체를 부모(CompanyHome)에게
  // 알려준다 - 좌측 주변식당 리스트도 같이 필터링하기 위함.
  onClusterClick?: (restaurants: RestaurantSummary[]) => void;
  // true면 이 컴포넌트가 받은 restaurants를 절대 다시 클러스터링/컬링하지 않고 전부 개별 마커로
  // 그린다 - 클러스터 클릭 직후(부모가 그 클러스터 멤버만 restaurants로 좁혀서 다시 내려줄 때)
  // "처음 클릭했을 때 전부 보여야 한다"는 요구사항을 보장하기 위함.
  disableClustering?: boolean;
  // 값이 바뀔 때마다(0보다 큰 값으로) 지도를 원래 중심/줌으로 되돌린다 ("홈으로" 버튼용).
  homeSignal?: number;
  // 2026-08-06 밤 신규: 지도 뷰포트 컬링 결과(현재 화면에 실제로 보이는 식당 id들)를 부모에게
  // 알려준다 - 직방/네이버부동산처럼 "지도에 보이는 것 = 리스트에 보이는 것"을 만들기 위함.
  // null이면 "제한 없음"(전체를 그대로 보여줘도 됨) - 지도가 아직 준비 안 됐거나, 컬링을
  // 건너뛰는 상태(disableClustering, 클러스터 클릭 직후)일 때 그렇다.
  onVisibleRestaurantsChange?: (ids: Set<string> | null) => void;
  // 2026-08-08 신규: 지도 중심/줌이 "홈" 위치(회사 중심, HOME_ZOOM)에서 조금이라도 벗어났는지를
  // 보고한다. 클러스터 확대/포커스 이동과는 별개로, 사용자가 지도를 직접 드래그/줌해서 조금이라도
  // 움직였을 때도 "전체 지도로 돌아가기" 버튼을 띄우기 위함 - idle마다(즉 boundsVersion이 바뀔
  // 때마다) 재계산해서 보고한다.
  onHomeStateChange?: (isAtHome: boolean) => void;
}

const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };
const HOME_ZOOM = 16;

// NCP 콘솔의 Map Style Editor에서 만든 커스텀 지도 스타일 ID (gl 벡터 지도 모드에서만 동작한다).
// 이 값이 비어있으면(아직 스타일을 안 만들었을 때) 아무것도 하지 않고 자동으로 기본(일반) 지도로
// 폴백된다 - 스타일 설정 여부와 무관하게 항상 안전하게 지도가 뜬다.
const NAVER_MAP_STYLE_ID = process.env.NEXT_PUBLIC_NAVER_MAP_STYLE_ID;

// 화면(지도 뷰포트) 밖 마커까지 다 그리면 식당이 많을 때 지도를 드래그할 때마다 브라우저가
// 수백 개의 DOM 오버레이 마커를 매 프레임 다시 배치해야 해서 눈에 띄게 렉이 생긴다
// (2026-08-06, "마커가 많을 때 맵을 움직이면 렉이 심해" 피드백). 그래서 현재 지도 화면 +
// 이 비율만큼의 여유 마진 안에 들어오는 식당만 실제로 마커를 만든다. 마진을 두는 이유는
// 마진이 없으면 살짝만 드래그해도 방금 화면 밖으로 나간 마커가 바로 사라졌다 나타났다 해서
// 부자연스럽기 때문. disableClustering이 true일 때는(클러스터를 방금 클릭해서 그 멤버만 보여줄
// 때) 이 컬링도 건너뛰고 무조건 전부 그린다 - fitBounds가 실패하거나 부정확해도 "전체를 반드시
// 보여줘야 한다"는 요구사항을 지키기 위함.
const VIEWPORT_CULL_MARGIN_RATIO = 0.6;

// 2026-08-06 추가: 뷰포트 컬링만으로는 렉이 개선되지 않았다는 피드백을 받음 (사용자 확인).
// 뷰포트 안에 들어오는 식당 수 자체가 많으면(같은 화면 안에 마커가 수십~백 개) 컬링을 해도
// 여전히 그만큼의 DOM 오버레이가 매 프레임 다시 배치돼야 해서 렉이 남는다. 그래서 화면에
// 보이는 식당 수가 CLUSTER_ACTIVATION_COUNT를 넘으면, 가까이 모여 있는 식당들을 하나의
// "클러스터" 마커(숫자 배지)로 합쳐서 그린다 - 실제로 그려지는 DOM 노드 수 자체를 줄이는
// 접근이라 컬링과는 다른 종류의 개선이다.
//
// 2026-08-06 오후 수정 (2차 피드백 대응): 클러스터를 클릭하면 "그 지점으로 확대"만 시켰었는데,
// 사용자가 실제로 눌러보니 두 가지 문제가 있었음 - (1) 확대해도 그 자리에 식당이 여전히 많으면
// 새로운(더 잘게 쪼개진) 클러스터가 또 나타나서 여러 번 눌러야 했고, (2) 이미 최대 줌(19)에
// 도달한 상태에서 클러스터를 누르면 setZoom(19)가 "값 변화 없음"이라 idle 이벤트가 안 나서
// 아예 반응이 없는 마커가 생겼음. 요구사항("처음 클릭했을 때 해당 가맹점은 모두 보여줘야 함")에
// 맞게, 이제 클러스터 클릭은 줌 단계에 의존하지 않고 그 그룹의 식당 id를 그대로 부모에게 넘겨서
// (onClusterClick) 부모가 해당 그룹만 다시 restaurants로 내려주고 disableClustering=true로
// 강제한다 - 그러면 줌/격자 크기와 무관하게 그 그룹 전체가 항상 개별 마커로 그려진다.
// 2026-08-06 밤: 드래그 렉이 계속 보고돼서 25 -> 12로 낮췄다. 화면에 보이는 개별(복잡한 DOM)
// 마커 수 자체를 더 일찍 줄여서, 지도 SDK가 드래그 중 매 프레임 다시 배치해야 하는 마커
// 개수를 더 공격적으로 줄인다 - 트레이드오프로 클러스터가 조금 더 자주/일찍 나타난다.
const CLUSTER_ACTIVATION_COUNT = 12;
// zoom 16 기준 격자 크기(위도/경도 도 단위). zoom이 1 줄어들 때마다(더 축소) 2배씩 커지고,
// zoom이 1 늘어날 때마다(더 확대) 절반씩 작아진다 - 확대할수록 클러스터가 잘게 쪼개진다.
const CLUSTER_GRID_DEGREES_AT_ZOOM16 = 0.0025;
const CLUSTER_GRID_REFERENCE_ZOOM = 16;

// "홈" 위치와의 일치 여부를 판단할 때 쓰는 위도/경도 허용 오차(도 단위, 약 5m 수준) - 부동소수점
// 계산 오차만 흡수할 정도로 작게 잡아서, 사용자가 실제로 지도를 드래그했으면 거의 항상 감지되게 한다.
const HOME_POSITION_EPSILON = 0.00005;

// 지도 중심/줌이 바뀌는 동안(드래그 도중) 계속 재계산하면 오히려 그 자체가 부담이 되므로,
// "idle" 이벤트(드래그/줌이 끝났을 때 딱 한 번 발생)에서만 다시 계산한다.
function getPaddedBounds(map: any, marginRatio: number) {
  try {
    if (!map?.getBounds) return null;
    const bounds = map.getBounds();
    if (!bounds || typeof bounds.getMin !== "function" || typeof bounds.getMax !== "function") {
      return null;
    }
    const min = bounds.getMin();
    const max = bounds.getMax();
    const latPad = (max.lat() - min.lat()) * marginRatio;
    const lngPad = (max.lng() - min.lng()) * marginRatio;
    return new window.naver.maps.LatLngBounds(
      new window.naver.maps.LatLng(min.lat() - latPad, min.lng() - lngPad),
      new window.naver.maps.LatLng(max.lat() + latPad, max.lng() + lngPad)
    );
  } catch {
    // Naver Maps API 버전에 따라 getMin/getMax/hasLatLng 시그니처가 다를 가능성에 대비한 안전장치.
    // 여기서 실패하면 null을 반환해서 아래 마커 effect가 "전체 다 그리기"(기존 동작)로 폴백한다.
    return null;
  }
}

interface ClusterGroup {
  key: string;
  lat: number;
  lng: number;
  restaurants: RestaurantSummary[];
}

// 화면에 보이는(컬링 후) 식당들을 zoom에 따라 크기가 달라지는 격자로 묶는다.
// 격자 하나에 식당이 1개면 그냥 개별 마커로, 2개 이상이면 클러스터로 취급한다(호출부에서 처리).
function groupIntoClusters(restaurants: RestaurantSummary[], zoom: number): ClusterGroup[] {
  const gridDegrees =
    CLUSTER_GRID_DEGREES_AT_ZOOM16 * Math.pow(2, CLUSTER_GRID_REFERENCE_ZOOM - zoom);

  const groups = new Map<string, ClusterGroup>();

  for (const restaurant of restaurants) {
    if (typeof restaurant.lat !== "number" || typeof restaurant.lng !== "number") continue;

    const cellX = Math.floor(restaurant.lat / gridDegrees);
    const cellY = Math.floor(restaurant.lng / gridDegrees);
    const key = `${cellX}_${cellY}`;

    const existing = groups.get(key);
    if (existing) {
      existing.restaurants.push(restaurant);
    } else {
      groups.set(key, { key, lat: restaurant.lat, lng: restaurant.lng, restaurants: [restaurant] });
    }
  }

  // 클러스터 마커 위치는 그룹 내 식당들의 평균 좌표로 잡아서, 격자 경계선이 아니라 실제
  // 식당들이 모인 지점 근처에 배지가 뜨도록 한다.
  for (const group of groups.values()) {
    if (group.restaurants.length <= 1) continue;
    const avgLat =
      group.restaurants.reduce((sum, r) => sum + r.lat, 0) / group.restaurants.length;
    const avgLng =
      group.restaurants.reduce((sum, r) => sum + r.lng, 0) / group.restaurants.length;
    group.lat = avgLat;
    group.lng = avgLng;
  }

  return Array.from(groups.values());
}

// 클러스터 멤버 전체가 화면에 들어오도록 지도를 이동/확대한다. fitBounds가 이 NCP Maps 버전에서
// 실제로 어떻게 동작하는지 라이브로 검증할 방법이 없어서(다른 Naver Maps API 호출과 마찬가지
// 이유), 있으면 쓰고 없거나 실패하면 "중심 이동 + 확대"로 폴백한다. 어느 쪽이든 disableClustering이
// 켜져 있는 한 그룹 전체는 항상 개별 마커로 그려지므로(뷰포트 컬링도 건너뜀), 지도가 완벽하게
// 맞춰 확대되지 않아도 "전체가 보인다"는 핵심 요구사항 자체는 깨지지 않는다.
function focusOnCluster(map: any, restaurants: RestaurantSummary[], fallbackZoom: number) {
  if (restaurants.length === 0) return;

  let minLat = restaurants[0].lat;
  let maxLat = restaurants[0].lat;
  let minLng = restaurants[0].lng;
  let maxLng = restaurants[0].lng;
  for (const r of restaurants) {
    minLat = Math.min(minLat, r.lat);
    maxLat = Math.max(maxLat, r.lat);
    minLng = Math.min(minLng, r.lng);
    maxLng = Math.max(maxLng, r.lng);
  }

  try {
    const bounds = new window.naver.maps.LatLngBounds(
      new window.naver.maps.LatLng(minLat, minLng),
      new window.naver.maps.LatLng(maxLat, maxLng)
    );
    if (typeof map.fitBounds === "function") {
      map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
      return;
    }
    throw new Error("fitBounds not available");
  } catch {
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    map.setCenter(new window.naver.maps.LatLng(centerLat, centerLng));
    map.setZoom(Math.min(fallbackZoom + 3, 19));
  }
}

// 2026-08-06 8차 수정: 7차에서는 naver Marker의 SDK 레벨 mouseover/mouseout 이벤트에서
// marker.setZIndex()로 z-index를 올리고 내렸다가 롤백했다 - 마커가 아닌 곳에서도 툴팁이 뜨는
// 새 버그가 생겼기 때문(스크린샷 확인). naver의 "mouseover"/"mouseout"은 SDK 자체의 근사
// 히트박스로 판정되고, setZIndex 호출이 오버레이 DOM을 다시 그리면서 실제 마우스 위치와
// 어긋난 채로 호버 상태(=툴팁 표시)가 남는 경우가 있었던 것으로 보임.
//
// 이번엔 SDK의 마커 이벤트/setZIndex를 전혀 쓰지 않는다. 마커 콘텐츠를 문자열이 아니라 실제
// HTMLElement로 직접 만들어서, 그 엘리먼트에 브라우저 네이티브 mouseenter/mouseleave를 건다.
// 네이티브 이벤트는 정확히 "이 엘리먼트의 실제 렌더링된 픽셀 위에 마우스가 있을 때"만 발생하고
// pointer-events:none인 (호버 전) 툴팁 영역은 히트테스트에서 자동으로 제외되므로, 마커가 아닌
// 곳에서 뜨는 문제 없이 z-index를 정확히 "호버 중인 그 순간에만" 계산해서 올리고, 벗어나면
// 즉시 원래 값(빈 문자열 = 기본 스택 순서)으로 되돌린다 - 정적 상수를 대입해두는 하드코딩이
// 아니라, 매 mouseenter/mouseleave 시점마다 값을 넣고 빼는 동적 처리다.
const MARKER_HOVER_ZINDEX = "1000";

// 2026-08-06 밤 추가: "지도를 드래그로 움직이면 화면이 마우스보다 늦게 따라온다"는 피드백을
// 다시 확인했다. 뷰포트 컬링/클러스터링으로 마커 "개수"는 이미 줄여뒀지만, 그 개수 안에서도
// 마커 하나하나가 무거우면(특히 이름 툴팁/클러스터 이름 목록을 평소에도 DOM에 항상 넣어두고
// CSS opacity로만 숨겨온 방식) 지도 SDK가 드래그 중 매 프레임 그 마커들을 다시 배치할 때
// 그만큼 더 많은 DOM/스타일 계산을 해야 한다. 툴팁 DOM을 "호버할 때만" 만들고 벗어나면 즉시
// 지워서, 평소(드래그하는 동안 포함) 마커의 DOM은 항상 최소한만 유지되게 한다.
// 2026-08-07: 클러스터 툴팁 안의 가맹점 이름을 클릭할 수 있게 하려면, 툴팁 DOM이 실제로
// 만들어진 뒤에 그 안의 개별 항목에 리스너를 달아야 한다. 그래서 buildTooltipHtml이 문자열
// 하나만 반환하던 것을 { html, onMount? } 형태로 바꿔서, onMount에서 방금 붙인 tooltipEl을
// 받아 내부 요소에 클릭 리스너를 걸 수 있게 한다(기존 호출부는 onMount 없이 html만 반환해도 그대로 동작).
interface TooltipSpec {
  html: string;
  onMount?: (tooltipEl: HTMLElement) => void;
}

function bindLazyTooltip(el: HTMLElement, buildTooltip: () => TooltipSpec) {
  if (!el.style.position) el.style.position = "relative";
  let tooltipEl: HTMLElement | null = null;

  el.addEventListener("mouseenter", () => {
    el.style.zIndex = MARKER_HOVER_ZINDEX;
    if (!tooltipEl) {
      const { html, onMount } = buildTooltip();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html.trim();
      tooltipEl = wrapper.firstElementChild as HTMLElement;
      if (tooltipEl) {
        el.appendChild(tooltipEl);
        onMount?.(tooltipEl);
      }
    }
  });
  el.addEventListener("mouseleave", () => {
    el.style.zIndex = "";
    tooltipEl?.remove();
    tooltipEl = null;
  });
}

// 마커의 "항상 보이는 부분"(bodyHtml)만 실제 DOM으로 만들고, 툴팁(buildTooltip)은
// 호버할 때만 지연 생성해서 붙인다. naver.maps.Marker의 icon.content에 문자열 대신 이
// 엘리먼트를 그대로 넘기면(NCP Maps v3는 HTMLElement도 허용) 우리가 붙인 리스너가 유지된다.
// 2026-08-12 신규: options.enableHoverTooltip=false면 mouseenter/mouseleave 리스너 자체를 안
// 붙인다 - 클러스터 마커의 검정 리스트 툴팁을 모바일에서 아예 안 띄우기 위함(아래 buildClusterMarkerIcon
// 참고). 기본값(true, 안 넘기면 그대로)은 기존 동작(개별 식당 마커 이름 툴팁 등) 그대로 유지.
function buildMarkerElement(
  bodyHtml: string,
  buildTooltip: () => TooltipSpec,
  options: { enableHoverTooltip?: boolean } = {}
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = bodyHtml.trim();
  const root = wrapper.firstElementChild as HTMLElement;
  if (options.enableHoverTooltip !== false) {
    bindLazyTooltip(root, buildTooltip);
  }
  return root;
}

// 네이버 지도(NCP Maps)를 쓰되, 기본 UI 느낌이 나지 않도록 스타일링 레이어를 별도로 관리한다.
// - 지도 색감: NCP 콘솔의 Map Style Editor에서 만든 커스텀 스타일 ID를 적용 (NAVER_MAP_STYLE_ID)
// - 마커: 카테고리별 이모지 아이콘 + 제로페이 배지, 호버 시 확대/이름 툴팁, 클릭 시 상세 모달 오픈
// - 마커가 많을 때는 뷰포트 컬링 + 클러스터링으로 실제 DOM 마커 수를 줄여 드래그 성능을 지킨다.
export default function MapView({
  companyCode,
  centerLat,
  centerLng,
  restaurants = [],
  focusTarget,
  onMarkerClick,
  onClusterClick,
  disableClustering = false,
  homeSignal = 0,
  onVisibleRestaurantsChange,
  onHomeStateChange,
}: MapViewProps) {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const companyMarkerRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  // 2026-08-10 신규: 창 크기 변경(resize)에 반응해 지도를 재조정할 때 쓰는 디바운스 타이머.
  // 아래 resize 이벤트 effect 참고.
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  // idle(드래그/줌 종료) 이벤트가 발생할 때마다 1씩 증가 - 아래 마커 effect가 이 값을 의존성으로
  // 갖고 있어서, 지도를 움직인 "직후"에만 화면에 보이는 마커를 다시 계산한다.
  const [boundsVersion, setBoundsVersion] = useState(0);

  // 2026-08-12 신규: 클러스터 마커의 검정 리스트 툴팁을 모바일에서는 아예 안 띄우기 위한 뷰포트
  // 감지(CompanyHome.tsx의 useIsDesktop과 동일한 768px 기준, 부호만 반대). 아래 마커 그리기
  // effect의 의존성에 포함시켜서, 창 폭이 브레이크포인트를 넘나들면(태블릿 회전 등) 다음 재계산
  // 때 바로 반영되게 한다.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  // 2026-08-06 저녁 추가: "즐겨찾기 하트 하나만 눌러도 지도 마커 전체가 다시 그려져서 렉이 난다"는
  // 문제를 발견해서 고침. 원인: 부모(CompanyHome)의 visibleRestaurants useMemo가 favoriteIds를
  // 의존성으로 갖고 있어서, "즐겨찾기" 필터가 켜져있지 않아 실제로는 결과에 아무 영향이 없어도
  // 즐겨찾기를 토글할 때마다 새 배열이 만들어진다. 그 새 배열이 restaurants prop으로 그대로
  // 내려오면, 아래 마커 effect가 restaurants "배열 참조"를 의존성으로 삼고 있었기 때문에 내용이
  // 하나도 안 바뀌었어도 매번 화면의 마커 전체를 지웠다가(setMap(null)) 처음부터 다시 만들었다 -
  // 식당이 많을 때 즐겨찾기 클릭 한 번마다 눈에 띄는 렉의 원인이었다.
  // 마커 모양/위치에 실제로 영향을 주는 필드만 뽑아 문자열 시그니처로 만들어서, 배열 참조가
  // 바뀌어도 "내용이 그대로면" 마커 effect가 다시 실행되지 않게 한다.
  const markerSignature = useMemo(
    () =>
      restaurants
        .map(
          (r) =>
            `${r.id}:${r.lat}:${r.lng}:${r.name}:${r.category ?? ""}:${r.isZeroPay ? 1 : 0}:${
              r.isZeroPayNeedsReview ? 1 : 0
            }`
        )
        .join("|"),
    [restaurants]
  );

  // NCP Maps 공식 인증 실패 콜백 - 등록 안 해두면 인증 실패 시 콘솔에 원인이 안 남고
  // 그냥 window.naver.maps가 비어있는 채로 남아서 아래 LatLng 호출에서 뜬금없는
  // "Cannot read properties of null" 에러로만 보임. 명확한 원인 로그를 남기기 위해 등록.
  useEffect(() => {
    window.navermap_authFailure = () => {
      console.error(
        "[NaverMaps] 인증 실패 - NCP 콘솔의 lunchtime Application > Web 서비스 URL에 현재 접속 origin이 등록되어 있는지 확인하세요."
      );
    };
  }, []);

  // 지도 인스턴스는 딱 한 번만 만든다. mapRef.current로 가드를 걸어서,
  // React 18 개발 모드의 이중 effect 실행(StrictMode)으로 같은 컨테이너에
  // 지도가 두 개 겹쳐 만들어지는 걸 막는다 (로그인 직후 화면이 잠깐 꼬여 보이던 원인).
  // window.naver.maps까지 확인하는 건, 인증 실패/Fast Refresh 등으로 naver 객체는 있는데
  // maps 네임스페이스가 아직(또는 끝내) 준비 안 된 경우 LatLng 호출에서 나던 null 에러 방지용.
  useEffect(() => {
    if (!ready || !mapElRef.current || !window.naver?.maps || mapRef.current) return;

    const resolvedLat = centerLat ?? FALLBACK_CENTER.lat;
    const resolvedLng = centerLng ?? FALLBACK_CENTER.lng;
    const center = new window.naver.maps.LatLng(resolvedLat, resolvedLng);

    mapRef.current = new window.naver.maps.Map(mapElRef.current, {
      center,
      zoom: HOME_ZOOM,
      // 2026-08-06 신규: 식당 마커를 워낙 많이 쌓다 보니(공공데이터 CSV 시딩) 네이버 지도 기본
      // POI 아이콘/상호명 라벨/버스정류장 등이 우리 마커와 겹쳐서 화면이 복잡해 보인다는
      // 피드백을 받았다. NCP Maps는 코드만으로 "단순 지도 모드"를 켜는 옵션이 따로 없고,
      // NCP 콘솔의 Map Style Editor에서 만든 커스텀 스타일(불필요한 레이어/라벨을 꺼둔 스타일)을
      // 발급받아 gl 벡터 지도 + customStyleId로 적용하는 방식만 지원한다. 스타일 ID를 아직 안
      // 만들었으면 NAVER_MAP_STYLE_ID가 비어있을 테니, 그럴 땐 자동으로 기본 지도로 폴백한다.
      ...(NAVER_MAP_STYLE_ID ? { gl: true, customStyleId: NAVER_MAP_STYLE_ID } : {}),
      zoomControl: false,
    });

    // 회사 위치 마커 - 커스텀 HTML 오버레이 (기본 빨간 핀 대신)
    companyMarkerRef.current = new window.naver.maps.Marker({
      position: center,
      map: mapRef.current,
      icon: {
        content: `<div class="rounded-full bg-primary text-white text-xs font-semibold px-2 py-1 shadow-soft">회사</div>`,
        anchor: new window.naver.maps.Point(20, 10),
      },
    });

    // 드래그/줌이 끝날 때마다(연속적으로가 아니라 "끝났을 때" 한 번) 화면에 보이는 마커를
    // 다시 계산하도록 신호를 준다. 드래그 도중 계속 재계산하면 그 자체가 렉의 원인이 되므로
    // 일부러 idle에서만 실행한다.
    window.naver.maps.Event.addListener(mapRef.current, "idle", () => {
      setBoundsVersion((v) => v + 1);
    });

    // 2026-08-10 신규: 지도는 생성 시점에 컨테이너의 CSS 크기를 한 번 측정해서 내부 렌더링
    // 크기를 잡는데, 그 시점에 레이아웃이 아직 완전히 자리잡지 않았을 수 있다(스크롤바 유무,
    // 사이드바 폭 계산 등). 다음 프레임에서 한 번 더 실제 크기를 재확인시켜서, "회사 기본
    // 위치가 지도 중심에서 살짝 오른쪽으로 쏠려 보인다"는 초기 렌더링 오차를 줄인다.
    requestAnimationFrame(() => {
      mapRef.current?.autoResize?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 2026-08-10 신규: "데스크톱에서 브라우저 창 크기가 바뀔 때도 필터/기본위치가 항상 지도의
  // 중심으로 오게 해달라"는 요청 중 지도 쪽 절반 - 지도 컨테이너는 CSS로 반응형(md:left-[448px]
  // 기준 나머지 폭)이라 창을 늘리거나 줄이면 실제로 "보이는 지도 영역"의 픽셀 크기가 계속
  // 바뀌는데, NCP Maps는 그 변화를 스스로 감지하지 못하고 생성 시점에 측정한 크기를 계속
  // 내부적으로 쓴다(공식 문서: autoResize()는 "지도 DOM 요소의 CSS 크기 변화에 따라 지도
  // 크기를 재설정"하는 API - 자동으로 매번 호출되는 게 아니라 필요할 때 명시적으로 불러줘야
  // 한다). 그래서 window resize마다 autoResize()로 최신 컨테이너 크기를 다시 읽게 하고, 그 뒤
  // 같은 중심 좌표로 setCenter를 한 번 더 불러서(autoResize만으로는 재조정된 화면 안에서 중심점이
  // 시각적으로 정확히 한가운데로 안 맞는 경우가 있어 안전하게 재확정) 창 크기가 바뀌어도 항상
  // 지금 보고 있던 지점이 보이는 지도 영역의 정가운데를 유지하게 한다. resize 이벤트는 드래그
  // 중 매 프레임 발생하므로 디바운스해서 과도한 재계산을 막는다.
  useEffect(() => {
    function handleResize() {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        const map = mapRef.current;
        if (!map || typeof map.autoResize !== "function") return;
        map.autoResize();
        const center = map.getCenter?.();
        if (center) map.setCenter(center);
      }, 150);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
  }, []);

  // 회사 좌표가 바뀌면(드문 경우) 지도를 다시 만들지 않고 중심/마커 위치만 옮긴다.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return;
    const resolvedLat = centerLat ?? FALLBACK_CENTER.lat;
    const resolvedLng = centerLng ?? FALLBACK_CENTER.lng;
    const center = new window.naver.maps.LatLng(resolvedLat, resolvedLng);
    mapRef.current.setCenter(center);
    companyMarkerRef.current?.setPosition(center);
  }, [centerLat, centerLng]);

  // 2026-08-06 오후 신규: "홈으로" 버튼 - homeSignal이 바뀔 때마다(0보다 큰 값일 때만) 원래
  // 중심/줌으로 되돌린다. 초기 마운트 시(homeSignal===0)에는 실행하지 않는다.
  useEffect(() => {
    if (!homeSignal || !mapRef.current || !window.naver?.maps) return;
    const resolvedLat = centerLat ?? FALLBACK_CENTER.lat;
    const resolvedLng = centerLng ?? FALLBACK_CENTER.lng;
    mapRef.current.setCenter(new window.naver.maps.LatLng(resolvedLat, resolvedLng));
    mapRef.current.setZoom(HOME_ZOOM);
  }, [homeSignal, centerLat, centerLng]);

  // 식당 마커는 별도 effect로 분리 - restaurants가 바뀔 때(예: 직접 추가 후 새로고침, 또는 클러스터
  // 클릭으로 부모가 그룹만 좁혀서 내려줄 때) 또는 지도를 움직여서 boundsVersion이 바뀔 때 다시
  // 그린다. id별로 markersRef에 저장해둬서, focusTarget effect에서 특정 마커를 다시 찾아 애니메이션을
  // 줄 수 있게 한다(클러스터로 묶인 식당은 markersRef에 저장하지 않음).
  //
  // 2026-08-06: 식당이 많을 때 전부 다 마커로 그리면 드래그할 때마다 브라우저가 수백 개의
  // DOM 오버레이를 매 프레임 다시 배치해야 해서 렉이 심했다. 뷰포트 컬링(화면 밖 마커는 안 그림)을
  // 1차로 적용했는데, 사용자가 실제로 확인해보니 여전히 렉이 개선되지 않았다고 함 - 화면 안에
  // 보이는 식당 수 자체가 많으면 컬링만으로는 부족하다는 뜻. 그래서 화면에 보이는 식당이
  // CLUSTER_ACTIVATION_COUNT를 넘으면 가까이 모인 식당들을 클러스터 배지 하나로 합쳐서
  // 실제 DOM 마커 수 자체를 줄인다(아래 groupIntoClusters). disableClustering이 true면(클러스터를
  // 방금 클릭한 직후) 이 모든 걸 건너뛰고 restaurants를 그대로 전부 개별 마커로 그린다.
  //
  // 2026-08-08 신규: "포커스 이동" 요구사항 - 리스트/인기Top3/투표/룰렛/검색 등 어디서 포커스를
  // 옮기든(전부 CompanyHome의 focusRestaurant -> focusTarget prop 이 경로 하나로 모인다) 그
  // 대상 가맹점이 클러스터에 묶여있으면 "숫자 배지"만 보이고 정작 어떤 마커가 그건지 눈에
  // 안 보이는 문제가 있었다. 그래서 focusTarget이 있으면 그 식당만 클러스터링 대상에서 항상
  // 제외하고(clusterPool), 별도로 확대된(더 큰 원 + 진한 링 + 핑 애니메이션) 마커로 무조건
  // 따로 그린다 - 클러스터 배지 숫자와 무관하게 "포커스된 곳은 항상 개별로, 항상 크게" 보이게.
  //
  // 2026-08-08 2차 신규: 확대된 포커스 마커를 되돌리는 자동 타이머 대신, 사용자가 "전체 지도로
  // 돌아가기" 버튼을 직접 눌러서 되돌리는 방식을 택했다(요청사항). 그래서 이 effect가 idle마다
  // 다시 돌 때 지도 중심/줌이 "홈" 위치에서 벗어나 있는지도 같이 계산해서 부모에게 보고한다 -
  // 클러스터 확대/포커스 이동뿐 아니라 사용자가 지도를 손으로 조금이라도 드래그/줌해도 이 버튼이
  // 뜨게 하기 위함.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return;

    const visible = disableClustering
      ? restaurants.filter(
          (restaurant) => typeof restaurant.lat === "number" && typeof restaurant.lng === "number"
        )
      : (() => {
          const padded = getPaddedBounds(mapRef.current, VIEWPORT_CULL_MARGIN_RATIO);
          return restaurants.filter((restaurant) => {
            if (typeof restaurant.lat !== "number" || typeof restaurant.lng !== "number") return false;
            if (!padded || typeof padded.hasLatLng !== "function") return true; // 폴백: 컬링 불가하면 전부 대상
            const position = new window.naver.maps.LatLng(restaurant.lat, restaurant.lng);
            return padded.hasLatLng(position);
          });
        })();

    // 2026-08-06 밤 신규: "지도에 보이는 것 = 리스트에 보이는 것"을 만들기 위해, 방금 계산한
    // 뷰포트 컬링 결과를 그대로 부모(CompanyHome)에게도 보고한다. disableClustering일 때는
    // (클러스터를 막 클릭해서 그 그룹 전체를 보여줘야 하는 상태) 뷰포트로 더 좁히면 안 되므로
    // null(제한 없음)을 보고해서 리스트가 부모가 이미 좁혀둔 클러스터 멤버 전체를 그대로 쓰게 한다.
    onVisibleRestaurantsChange?.(
      disableClustering ? null : new Set(visible.map((restaurant) => restaurant.id))
    );

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = new Map();

    let currentZoom = HOME_ZOOM;
    try {
      currentZoom =
        typeof mapRef.current.getZoom === "function" ? mapRef.current.getZoom() : HOME_ZOOM;
    } catch {
      currentZoom = HOME_ZOOM;
    }

    // 2026-08-08 2차 신규: 지도 중심이 "홈" 위치(회사 중심, HOME_ZOOM)와 사실상 같은지 확인해서
    // 부모에게 보고한다 - 실패해도(구버전 API 시그니처 차이 등) 무시하고 "홈에 있다"로 간주한다
    // (버튼이 잘못 사라지는 쪽이, 잘못 계속 떠 있는 쪽보다 덜 거슬린다고 판단).
    try {
      const center = mapRef.current.getCenter?.();
      if (center && typeof center.lat === "function" && typeof center.lng === "function") {
        const homeLat = centerLat ?? FALLBACK_CENTER.lat;
        const homeLng = centerLng ?? FALLBACK_CENTER.lng;
        const atHome =
          Math.abs(center.lat() - homeLat) < HOME_POSITION_EPSILON &&
          Math.abs(center.lng() - homeLng) < HOME_POSITION_EPSILON &&
          currentZoom === HOME_ZOOM;
        onHomeStateChange?.(atHome);
      }
    } catch {
      onHomeStateChange?.(true);
    }

    // 2026-08-08 신규: focusTarget이 있으면 그 식당은 클러스터링 대상 풀에서 미리 빼둔다 -
    // 그러면 그룹 내 나머지 멤버만으로 클러스터가 만들어지고(예: 3곳이던 클러스터가 2곳으로
    // 줄거나, 아예 사라져서 그 하나만 남을 수도 있음), 아래에서 그 식당을 항상 확대된 개별
    // 마커로 별도 그린다.
    const focusedId = focusTarget?.id ?? null;
    const clusterPool = focusedId ? visible.filter((r) => r.id !== focusedId) : visible;

    const shouldCluster = !disableClustering && visible.length > CLUSTER_ACTIVATION_COUNT;
    const groups = shouldCluster ? groupIntoClusters(clusterPool, currentZoom) : null;

    if (groups) {
      for (const group of groups) {
        const position = new window.naver.maps.LatLng(group.lat, group.lng);

        if (group.restaurants.length === 1) {
          const restaurant = group.restaurants[0];
          const marker = new window.naver.maps.Marker({
            position: new window.naver.maps.LatLng(restaurant.lat, restaurant.lng),
            map: mapRef.current,
            icon: buildRestaurantMarkerIcon(restaurant),
          });
          if (onMarkerClick) {
            window.naver.maps.Event.addListener(marker, "click", () => onMarkerClick(restaurant));
          }
          markersRef.current.set(restaurant.id, marker);
          continue;
        }

        const marker = new window.naver.maps.Marker({
          position,
          map: mapRef.current,
          // .normalize("NFC"): some restaurant names are stored as decomposed Hangul jamo
          // (NFD) instead of composed syllable blocks (NFC) - likely from data entered/synced
          // on macOS at some point. At normal marker/list font sizes this mostly renders okay,
          // but packed into this small tooltip it showed up as garbled/underline-looking glyphs
          // (screenshot). Force-normalizing to NFC here is a safe no-op for already-correct
          // names and fixes the decomposed ones.
          // 2026-08-07: 이름 목록만 넘기던 것을 group(실제 식당 객체 포함)으로 바꿔서, 툴팁 안의
          // 각 이름을 클릭했을 때 그 가맹점 정보(상세모달)를 바로 열 수 있게 한다.
          icon: buildClusterMarkerIcon(group, onMarkerClick, isMobile),
        });

        // 2026-08-06 오후 수정: 클릭하면 "몇 단계 확대"가 아니라, 그 그룹 전체를 부모에게 넘겨서
        // (부모가 disableClustering=true로 다시 내려줌) 항상 한 번에 전부 개별 마커로 드러나게 한다.
        // 지도 이동/확대는 focusOnCluster가 fitBounds(또는 폴백)로 시각적으로 보조만 한다.
        window.naver.maps.Event.addListener(marker, "click", () => {
          onClusterClick?.(group.restaurants);
          focusOnCluster(mapRef.current, group.restaurants, currentZoom);
        });

        markersRef.current.set(`cluster_${group.key}`, marker);
      }
    } else {
      for (const restaurant of clusterPool) {
        const position = new window.naver.maps.LatLng(restaurant.lat, restaurant.lng);
        const marker = new window.naver.maps.Marker({
          position,
          map: mapRef.current,
          icon: buildRestaurantMarkerIcon(restaurant),
        });
        if (onMarkerClick) {
          window.naver.maps.Event.addListener(marker, "click", () => onMarkerClick(restaurant));
        }
        markersRef.current.set(restaurant.id, marker);
      }
    }

    // 2026-08-08 신규: 포커스된 식당은 (클러스터 여부와 무관하게) 항상 별도로, 항상 확대된
    // 아이콘으로 그린다 - 위에서 clusterPool/groups 어느 쪽에도 이 식당은 포함되지 않았으므로
    // 중복 렌더링 걱정 없이 여기서 한 번만 그리면 된다. visible에 없으면(아직 뷰포트가 그
    // 위치로 안 옮겨진 상태) 이번 패스에서는 그리지 않고, 지도가 이동해서 boundsVersion이
    // 갱신되면 이 effect가 다시 돌면서 그때 그려진다.
    if (focusedId) {
      const focusedRestaurant = visible.find((r) => r.id === focusedId);
      if (focusedRestaurant) {
        const marker = new window.naver.maps.Marker({
          position: new window.naver.maps.LatLng(focusedRestaurant.lat, focusedRestaurant.lng),
          map: mapRef.current,
          icon: buildRestaurantMarkerIcon(focusedRestaurant, { focused: true }),
          zIndex: 200,
        });
        if (onMarkerClick) {
          window.naver.maps.Event.addListener(marker, "click", () => onMarkerClick(focusedRestaurant));
        }
        markersRef.current.set(focusedRestaurant.id, marker);
      }
    }
    // restaurants "배열 참조"가 아니라 markerSignature(내용 기반)를 의존성으로 쓴다 - 위 주석 참고.
    // focusTarget?.id도 의존성에 넣어서, 포커스 대상이 바뀔 때마다 이 effect가 다시 돌아
    // 이전 포커스 마커는 보통 크기로 되돌리고 새 포커스 마커만 확대되게 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    markerSignature,
    ready,
    onMarkerClick,
    onClusterClick,
    disableClustering,
    boundsVersion,
    onVisibleRestaurantsChange,
    onHomeStateChange,
    focusTarget?.id,
    centerLat,
    centerLng,
    isMobile,
  ]);

  // 리스트/인기Top3/투표/룰렛/검색 등에서 포커스를 옮겼을 때 지도를 그 위치로 이동시키고
  // 마커를 잠깐 튀게 한다(확대 자체는 위 마커 effect가 담당 - 여기는 이동 + 바운스 애니메이션만).
  useEffect(() => {
    if (!mapRef.current || !focusTarget || !window.naver?.maps) return;

    const target = new window.naver.maps.LatLng(focusTarget.lat, focusTarget.lng);
    mapRef.current.setCenter(target);
    mapRef.current.setZoom(18);

    // focusTarget으로 이동한 곳이 방금까지의 뷰포트 컬링 범위 밖이었을 수 있으므로(예: 리스트에서
    // 멀리 있는 식당을 클릭), 해당 위치의 마커가 아직 markersRef에 없을 수 있다. setCenter/setZoom은
    // "idle" 이벤트를 발생시키므로 boundsVersion이 곧 갱신되어 마커 effect가 다시 돌고(이때
    // focusTarget?.id도 그대로 의존성에 있으니 확대 마커도 함께 그려짐), 이번 클릭에서 바로
    // 바운스 애니메이션을 주려는 마커가 그 사이에 없을 수 있어 존재 여부를 확인 후 처리한다.
    const marker = markersRef.current.get(focusTarget.id);
    if (marker && window.naver.maps.Animation) {
      marker.setAnimation(window.naver.maps.Animation.BOUNCE);
      const timer = setTimeout(() => marker.setAnimation(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [focusTarget]);

  return (
    <>
      <Script
        src={`https://openapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID}${
          NAVER_MAP_STYLE_ID ? "&submodules=gl" : ""
        }`}
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      {/* 2026-08-07: 데스크톱에서는 좌측에 주변식당/캘린더 카드(md:left-6, 폭 400px)가 항상 떠
          있어서, 그 뒤에 깔리는 지도 영역(왼쪽 0~424px)은 어차피 안 보이는 "죽은 부분"이었다.
          지도 컨테이너 자체를 그 카드 폭만큼 오른쪽에서 시작하게 해서 실제로 보이는 영역만
          그리도록 한다 - 모바일은 카드가 화면 하단에 뜨는 구조라 해당 없음(기존처럼 전체 화면).
          2026-08-07 수정: 카드 왼쪽 여백(md:left-6 = 24px)과 똑같은 폭의 여백을 카드 오른쪽에도
          둬서 카드가 화면 가장자리와 지도 사이에서 좌우 대칭으로 "떠 있는" 느낌이 나게 한다
          (24px 여백 + 400px 카드 폭 + 24px 여백 = 448px 지점부터 지도 시작). */}
      <div ref={mapElRef} className="absolute inset-0 z-0 h-full w-full md:left-[448px]" />
    </>
  );
}

// 식당 마커를 카테고리별 이모지 아이콘 + 제로페이 배지로 그리는 헬퍼.
// 2026-08-06 밤: 이름 툴팁을 항상 DOM에 넣어두고 CSS group-hover로만 숨기던 방식에서,
// buildMarkerElement의 두 번째 인자(buildTooltipHtml)로 넘겨서 실제 호버할 때만 만들어
// 붙이는 방식으로 바꿨다 - 평소 마커의 DOM을 가볍게 유지해서 드래그 중 재배치 비용을 줄인다.
// shadow-soft(box-shadow)도 마커 자체에서는 빼서(항상 존재하는 요소라 누적 비용이 크다)
// ring만으로 테두리를 표현한다.
//
// 2026-08-08 신규: options.focused가 true면(지금 포커스 이동 대상인 가맹점) 평소보다 훨씬
// 크게(32px -> 44px), 링을 더 진하게(ring-2 ring-white -> ring-4 ring-primary), 뒤에 은은하게
// 퍼지는 핑 애니메이션(animate-ping)까지 붙여서 클러스터에 섞여 있어도 "이게 그거다"가 한눈에
// 보이게 한다.
export function buildRestaurantMarkerIcon(
  restaurant: RestaurantSummary,
  options: { focused?: boolean } = {}
) {
  const visual = getCategoryVisual(restaurant.category, restaurant.categoryLabel, restaurant.name);
  const displayName = (restaurant.name ?? "").normalize("NFC");
  const zeroPayBadge = restaurant.isZeroPay
    ? `<span class="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] text-white ring-1 ring-white">₩</span>`
    : "";
  // 2026-08-06 신규: 최근 거꾸로엄지척이 많아져 재확인이 필요한 곳은 마커에도 작은 경고 배지를 얹는다.
  const needsReviewBadge = restaurant.isZeroPayNeedsReview
    ? `<span class="absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] ring-1 ring-white">⚠️</span>`
    : "";

  const focused = options.focused ?? false;
  const sizeClass = focused ? "h-11 w-11 text-xl" : "h-8 w-8 text-base";
  const ringClass = focused ? "ring-4 ring-primary" : "ring-2 ring-white";
  const pingHtml = focused
    ? `<div class="absolute inset-0 -m-2 rounded-full bg-primary/40 animate-ping"></div>`
    : "";
  const anchorPoint = focused ? 22 : 16;

  return {
    content: buildMarkerElement(
      `
      <div class="group relative flex flex-col items-center" style="cursor:pointer;">
        ${pingHtml}
        <div
          class="relative flex ${sizeClass} items-center justify-center rounded-full ${ringClass} transition-transform duration-150 group-hover:scale-125"
          style="background:${visual.color}"
        >
          ${visual.emoji}
          ${zeroPayBadge}
          ${needsReviewBadge}
        </div>
      </div>
    `,
      () => ({
        html: `
        <span class="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2 py-1 text-[10px] font-medium text-white shadow-soft">
          ${displayName}
        </span>
      `,
      })
    ),
    anchor: new window.naver.maps.Point(anchorPoint, anchorPoint),
  };
}

// 클러스터(여러 식당이 모인 지점) 마커 - 개별 식당 아이콘 대신 숫자 배지 원 하나로 표시해서
// 실제 DOM 마커 수를 줄인다. 클릭하면 그 그룹 전체가 (줌 단계와 무관하게) 바로 개별 마커로 풀린다.
//
// 마우스를 올렸을 때(클릭하기 전에) 그 안에 어떤 가맹점들이 있는지 미리 볼 수 있게 툴팁으로
// 보여준다 - 클릭해서 확대하기 전에 "여기 뭐가 있는지" 감을 잡을 수 있게. 이름이 너무 많으면
// 다 나열하지 않고 상위 N개 + "외 n곳"으로 자른다.
//
// 2026-08-06 밤: 이름 목록(최대 60개 <div>)을 예전엔 클러스터마다 항상 DOM에 만들어두고
// CSS로만 숨겼었다 - 클러스터가 여러 개면 그만큼 항상 무거운 DOM을 지도가 드래그 중에도
// 계속 재배치해야 했다. 이제는 buildMarkerElement의 두 번째 인자로 넘겨서 실제 호버할 때만
// 이름 목록을 만든다. 식당이 많을 때(20개 이상) 11px 글자를 여백 없이 다닥다닥 붙여두면
// 어디서 한 이름이 끝나고 다음 이름이 시작하는지 구분이 안 되고 뭉개져 보인다는 피드백을
// 받아서, 폭을 200→240px로, 글자를 11→12px로 늘리고 이름 사이에 구분선(divide-y)을 넣어서
// 줄 단위로 또렷하게 보이게 했다. "총 N곳" 헤더는 스크롤해도 항상 맨 위에 남는다.
//
// 2026-08-07 신규: 툴팁에 뜬 이름을 클릭하면 그 가맹점의 상세 정보(RestaurantDetail 모달)가
// 바로 열리게 한다 - 예전엔 목록만 보여주고 클릭해도 아무 반응이 없었다. onMount에서 각 이름
// <div>에 클릭 리스너를 걸어 onSelectRestaurant(마커 클릭과 동일한 핸들러)를 호출한다.
//
// 2026-08-12 신규: 이 툴팁(스크롤 가능한 검정 리스트)은 데스크톱 마우스 hover 전용으로 설계됐다
// (onwheel/onmousedown만 stopPropagation 처리되어 있고 touchmove는 처리 안 됨). 모바일에서는
// 탭이 mouseenter를 흉내내면서 툴팁이 뜨긴 뜨는데, 안에서 스와이프하면 touchmove가 그대로
// 지도 컨테이너까지 버블링돼서 지도가 팬되어버리고 리스트 자체는 스크롤이 안 되는 문제가 있었다
// (사용자 실사용 패턴도 "리스트보다 지도 확대해서 마커 직접 탭"이라, 고치는 것보다 모바일에서는
// 이 툴팁을 아예 안 띄우는 쪽을 택함 - isMobile이 true면 buildMarkerElement에
// enableHoverTooltip:false를 넘겨서 mouseenter 리스너 자체를 안 붙인다. 탭하면 hover 없이
// 바로 아래 "click" 리스너(onClusterClick + focusOnCluster)만 동작해서 즉시 확대된다.
function buildClusterMarkerIcon(
  group: ClusterGroup,
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void,
  isMobile?: boolean
) {
  const count = group.restaurants.length;
  // 식당 수가 많을수록 살짝 더 크게 - 한눈에 "여기 많이 모여있다"는 걸 알 수 있게.
  const size = count >= 50 ? 44 : count >= 10 ? 38 : 32;

  return {
    content: buildMarkerElement(
      `
      <div class="group relative flex flex-col items-center" style="cursor:pointer;">
        <div
          class="flex items-center justify-center rounded-full bg-ink text-sm font-bold text-white ring-2 ring-white transition-transform duration-150 group-hover:scale-110"
          style="width:${size}px;height:${size}px;"
        >
          ${count}
        </div>
      </div>
    `,
      () => {
        const TOOLTIP_MAX_NAMES = 60;
        const shown = group.restaurants.slice(0, TOOLTIP_MAX_NAMES);
        const remaining = group.restaurants.length - shown.length;
        const namesHtml =
          shown
            .map(
              (r, i) =>
                `<div class="cursor-pointer py-1 break-words transition hover:text-primary-light" data-restaurant-idx="${i}">${(r.name ?? "").normalize("NFC")}</div>`
            )
            .join("") +
          (remaining > 0 ? `<div class="py-1 text-white/60">외 ${remaining}곳</div>` : "");

        return {
          html: `
          <div
            class="pointer-events-auto absolute bottom-full left-1/2 mb-1.5 flex w-[240px] max-h-[260px] -translate-x-1/2 flex-col overflow-y-auto whitespace-normal divide-y divide-white/10 rounded-lg bg-ink px-3 py-1 text-left text-[12px] leading-snug text-white shadow-soft"
            onwheel="event.stopPropagation()"
            onmousedown="event.stopPropagation()"
          >
            <div class="sticky top-0 bg-ink py-1.5 text-[10px] font-semibold text-white/60">총 ${count}곳</div>
            ${namesHtml}
          </div>
        `,
          onMount: (tooltipEl) => {
            if (!onSelectRestaurant) return;
            tooltipEl.querySelectorAll<HTMLElement>("[data-restaurant-idx]").forEach((node) => {
              const restaurant = shown[Number(node.dataset.restaurantIdx)];
              if (!restaurant) return;
              // mousedown도 막아야 지도 드래그가 시작되지 않는다(컨테이너의 onmousedown과 동일한 이유).
              node.addEventListener("mousedown", (e) => e.stopPropagation());
              node.addEventListener("click", (e) => {
                e.stopPropagation();
                onSelectRestaurant(restaurant);
              });
            });
          },
        };
      },
      { enableHoverTooltip: !isMobile }
    ),
    anchor: new window.naver.maps.Point(size / 2, size / 2),
  };
}
