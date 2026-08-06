"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
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
}

const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };
const HOME_ZOOM = 16;

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
const CLUSTER_ACTIVATION_COUNT = 25;
// zoom 16 기준 격자 크기(위도/경도 도 단위). zoom이 1 줄어들 때마다(더 축소) 2배씩 커지고,
// zoom이 1 늘어날 때마다(더 확대) 절반씩 작아진다 - 확대할수록 클러스터가 잘게 쪼개진다.
const CLUSTER_GRID_DEGREES_AT_ZOOM16 = 0.0025;
const CLUSTER_GRID_REFERENCE_ZOOM = 16;

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

// 2026-08-06 5차 수정: 네이버 지도 마커는 기본적으로 내부 규칙(위치 등)으로 z-index가 정해져서,
// 툴팁이 위로 펼쳐지는 마커라도 근처의 다른 마커 배지가 툴팁 위로 덮어버리는 문제가 있었다
// (스크린샷으로 확인 - 다른 숫자 배지가 툴팁 박스 위에 얹혀서 깨진 것처럼 보임). 마우스오버한
// 마커의 zIndex를 그 순간만 아주 높게 올려서 항상 다른 마커보다 위에 그려지게 하고, 마우스가
// 빠지면 원래 값으로 되돌린다.
// ROLLED BACK 2026-08-06 (7th round): the per-marker z-index hover boost below caused a
// worse bug - hovering empty map area near a marker (not the marker itself) could still
// trigger the tooltip, because raising z-index made the marker's whole content box (including
// the large invisible tooltip area) sit on top of everything else and intercept hover.
// Removed entirely; see the pointer-events fix on the tooltip element itself instead, which is
// the actual correct fix for hover targeting.
/* const MARKER_DEFAULT_ZINDEX = 100;
const MARKER_HOVER_ZINDEX = 1000;

function bindHoverZIndexBoost(marker: any) {
  try {
    marker.setZIndex(MARKER_DEFAULT_ZINDEX);
  } catch {
    // 구버전 Naver Maps API에 setZIndex가 없을 가능성 대비 - 없으면 기본 스택 순서로 둔다.
  }
  window.naver.maps.Event.addListener(marker, "mouseover", () => {
    try {
      marker.setZIndex(MARKER_HOVER_ZINDEX);
    } catch {}
  });
  window.naver.maps.Event.addListener(marker, "mouseout", () => {
    try {
      marker.setZIndex(MARKER_DEFAULT_ZINDEX);
    } catch {}
  });
} */
function bindHoverZIndexBoost(marker: any) {
  // no-op: rolled back, see comment above
}

// 네이버 지도(NCP Maps)를 쓰되, 기본 UI 느낌이 나지 않도록 스타일링 레이어를 별도로 관리한다.
// - 지도 색감: NCP 콘솔의 Map Style Editor에서 만든 커스텀 스타일 ID를 적용 (아래 mapStyleId)
// - 마커: 카테고리별 이모지 아이콘 + 제로페이 배지, 호버 시 확대/이름 툴팁, 클릭 시 상세 모달 오픈
// - 마커가 많을 때는 뷰포트 컬링 + 클러스터링으로 실제 DOM 마커 수를 줄여 드래그 성능을 지킨다.
// TODO: 네이버 지도 Map Style Editor 커스텀 스타일 ID 발급 후 적용
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
}: MapViewProps) {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const companyMarkerRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [ready, setReady] = useState(false);
  // idle(드래그/줌 종료) 이벤트가 발생할 때마다 1씩 증가 - 아래 마커 effect가 이 값을 의존성으로
  // 갖고 있어서, 지도를 움직인 "직후"에만 화면에 보이는 마커를 다시 계산한다.
  const [boundsVersion, setBoundsVersion] = useState(0);

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
      // NCP 콘솔 > Map Style Editor에서 발급한 커스텀 스타일 ID로 교체
      // customStyleId: process.env.NEXT_PUBLIC_NAVER_MAP_STYLE_ID,
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
  }, [ready]);

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

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = new Map();

    let currentZoom = HOME_ZOOM;
    try {
      currentZoom =
        typeof mapRef.current.getZoom === "function" ? mapRef.current.getZoom() : HOME_ZOOM;
    } catch {
      currentZoom = HOME_ZOOM;
    }

    const shouldCluster = !disableClustering && visible.length > CLUSTER_ACTIVATION_COUNT;
    const groups = shouldCluster ? groupIntoClusters(visible, currentZoom) : null;

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
          bindHoverZIndexBoost(marker);
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
          icon: buildClusterMarkerIcon(
            group.restaurants.length,
            group.restaurants.map((r) => (r.name ?? "").normalize("NFC"))
          ),
        });
        bindHoverZIndexBoost(marker);

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
      for (const restaurant of visible) {
        const position = new window.naver.maps.LatLng(restaurant.lat, restaurant.lng);
        const marker = new window.naver.maps.Marker({
          position,
          map: mapRef.current,
          icon: buildRestaurantMarkerIcon(restaurant),
        });
        bindHoverZIndexBoost(marker);
        if (onMarkerClick) {
          window.naver.maps.Event.addListener(marker, "click", () => onMarkerClick(restaurant));
        }
        markersRef.current.set(restaurant.id, marker);
      }
    }
  }, [restaurants, ready, onMarkerClick, onClusterClick, disableClustering, boundsVersion]);

  // 리스트에서 "이미 있어요" / 방금 추가한 식당을 눌렀을 때 지도를 그 위치로 이동시키고 마커를 잠깐 튀게 한다.
  useEffect(() => {
    if (!mapRef.current || !focusTarget || !window.naver?.maps) return;

    const target = new window.naver.maps.LatLng(focusTarget.lat, focusTarget.lng);
    mapRef.current.setCenter(target);
    mapRef.current.setZoom(18);

    // focusTarget으로 이동한 곳이 방금까지의 뷰포트 컬링 범위 밖이었거나 클러스터로 묶여 있었을
    // 수 있으므로(예: 리스트에서 멀리 있는 식당을 클릭), 해당 위치의 개별 마커가 아직 markersRef에
    // 없을 수 있다. setCenter/setZoom은 "idle" 이벤트를 발생시키므로 boundsVersion이 곧 갱신되어
    // 마커 effect가 다시 돌지만(줌이 늘어서 클러스터도 풀림), 이번 클릭에서 바로 애니메이션을
    // 주려는 마커가 그 사이에 없을 수 있어 존재 여부를 확인 후 처리한다.
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
        src={`https://openapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID}`}
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={mapElRef} className="absolute inset-0 z-0 h-full w-full" />
    </>
  );
}

// 식당 마커를 카테고리별 이모지 아이콘 + 제로페이 배지로 그리는 헬퍼.
// 마커 HTML 안에 group/group-hover 클래스를 써서, 마우스 오버 시 순수 CSS로
// 마커가 커지고 이름 툴팁이 뜨게 한다 (별도 JS 이벤트 리스너 없이 처리).
export function buildRestaurantMarkerIcon(restaurant: RestaurantSummary) {
  const visual = getCategoryVisual(restaurant.category);
  const displayName = (restaurant.name ?? "").normalize("NFC");
  const zeroPayBadge = restaurant.isZeroPay
    ? `<span class="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] text-white ring-1 ring-white">₩</span>`
    : "";
  // 2026-08-06 신규: 최근 거꾸로엄지척이 많아져 재확인이 필요한 곳은 마커에도 작은 경고 배지를 얹는다.
  const needsReviewBadge = restaurant.isZeroPayNeedsReview
    ? `<span class="absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] ring-1 ring-white">⚠️</span>`
    : "";

  return {
    content: `
      <div class="group relative flex flex-col items-center" style="cursor:pointer;">
        <span class="pointer-events-none absolute -top-7 whitespace-nowrap rounded-full bg-ink px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-soft transition-opacity duration-150 group-hover:opacity-100">
          ${displayName}
        </span>
        <div
          class="relative flex h-8 w-8 items-center justify-center rounded-full text-base shadow-soft ring-2 ring-white transition-transform duration-150 group-hover:scale-125"
          style="background:${visual.color}"
        >
          ${visual.emoji}
          ${zeroPayBadge}
          ${needsReviewBadge}
        </div>
      </div>
    `,
    anchor: new window.naver.maps.Point(16, 16),
  };
}

// 클러스터(여러 식당이 모인 지점) 마커 - 개별 식당 아이콘 대신 숫자 배지 원 하나로 표시해서
// 실제 DOM 마커 수를 줄인다. 클릭하면 그 그룹 전체가 (줌 단계와 무관하게) 바로 개별 마커로 풀린다.
//
// 2026-08-06 3차 신규: 마우스를 올렸을 때(클릭하기 전에) 그 안에 어떤 가맹점들이 있는지 미리
// 볼 수 있게 툴팁으로 보여준다 - 클릭해서 확대하기 전에 "여기 뭐가 있는지" 감을 잡을 수 있게.
// 이름이 너무 많으면 다 나열하지 않고 상위 N개 + "외 n곳"으로 자른다. 개별 식당 마커의 이름
// 툴팁(buildRestaurantMarkerIcon)과 동일하게 group/group-hover 클래스만으로 처리해서 별도
// JS 이벤트 리스너가 필요 없다.
function buildClusterMarkerIcon(count: number, names: string[]) {
  // 식당 수가 많을수록 살짝 더 크게 - 한눈에 "여기 많이 모여있다"는 걸 알 수 있게.
  const size = count >= 50 ? 44 : count >= 10 ? 38 : 32;

  // 2026-08-06 6차 수정: 4~5차에서 폭/힌게이마임, z-index는 고쳤는데, 식당이 26개대로 정말 많을 땐는
  // 11px 글자를 gap만 둔 다닥다닥 붙놓아서 어디서 이름이 끓냂고 다음 이름이 시작하는지 구뚞이
  // 안 되고 화상이 눌린 것처럼 깨져 보인다는 피럜백을 받았음(스크린샷 확인). 폭을 200→240px,
  // 글자를 11→12px로 살짝 늘리고, 이름 사이에 구보선(divide-y)을 넣어서 줄 단위로 따럜하게 스쳨되게
  // 했다. "총 N곳" 헤더는 스크롤해도 항상 농다(목록이 어딴까지 왜는지 기준점 유지).
  const TOOLTIP_MAX_NAMES = 60;
  const shown = names.slice(0, TOOLTIP_MAX_NAMES);
  const remaining = names.length - shown.length;
  const namesHtml =
    shown.map((name) => `<div class="py-1 break-words">${name}</div>`).join("") +
    (remaining > 0 ? `<div class="py-1 text-white/60">외 ${remaining}곳</div>` : "");

  return {
    content: `
      <div class="group relative flex flex-col items-center" style="cursor:pointer;">
        <div
          class="pointer-events-none absolute bottom-full mb-1.5 flex w-[240px] max-h-[260px] flex-col overflow-y-auto whitespace-normal divide-y divide-white/10 rounded-lg bg-ink px-3 py-1 text-left text-[12px] leading-snug text-white opacity-0 shadow-soft transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
          onwheel="event.stopPropagation()"
          onmousedown="event.stopPropagation()"
        >
          <div class="sticky top-0 bg-ink py-1.5 text-[10px] font-semibold text-white/60">총 ${count}곳</div>
          ${namesHtml}
        </div>
        <div
          class="flex items-center justify-center rounded-full bg-ink text-sm font-bold text-white shadow-soft ring-2 ring-white transition-transform duration-150 group-hover:scale-110"
          style="width:${size}px;height:${size}px;"
        >
          ${count}
        </div>
      </div>
    `,
    anchor: new window.naver.maps.Point(size / 2, size / 2),
  };
}
