"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { RestaurantSummary } from "@/types";
import type { FocusTarget } from "./CompanyHome";
import { getCategoryVisual } from "@/lib/restaurant-category";

declare global {
  interface Window {
    naver: any;
  }
}

interface MapViewProps {
  companyCode: string;
  centerLat?: number;
  centerLng?: number;
  restaurants?: RestaurantSummary[];
  focusTarget?: FocusTarget | null;
  onMarkerClick?: (restaurant: RestaurantSummary) => void;
}

const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };

// 네이버 지도(NCP Maps)를 쓰되, 기본 UI 느낌이 나지 않도록 스타일링 레이어를 별도로 관리한다.
// - 지도 색감: NCP 콘솔의 Map Style Editor에서 만든 커스텀 스타일 ID를 적용 (아래 mapStyleId)
// - 마커: 카테고리별 이모지 아이콘 + 제로페이 배지, 호버 시 확대/이름 툴팁, 클릭 시 상세 모달 오픈
// TODO: 네이버 지도 Map Style Editor 커스텀 스타일 ID 발급 후 적용
export default function MapView({
  companyCode,
  centerLat,
  centerLng,
  restaurants = [],
  focusTarget,
  onMarkerClick,
}: MapViewProps) {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const companyMarkerRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [ready, setReady] = useState(false);

  // 지도 인스턴스는 딱 한 번만 만든다. mapRef.current로 가드를 걸어서,
  // React 18 개발 모드의 이중 effect 실행(StrictMode)으로 같은 컨테이너에
  // 지도가 두 개 겹쳐 만들어지는 걸 막는다 (로그인 직후 화면이 잠깐 꼬여 보이던 원인).
  useEffect(() => {
    if (!ready || !mapElRef.current || !window.naver || mapRef.current) return;

    const resolvedLat = centerLat ?? FALLBACK_CENTER.lat;
    const resolvedLng = centerLng ?? FALLBACK_CENTER.lng;
    const center = new window.naver.maps.LatLng(resolvedLat, resolvedLng);

    mapRef.current = new window.naver.maps.Map(mapElRef.current, {
      center,
      zoom: 16,
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
  }, [ready]);

  // 회사 좌표가 바뀌면(드문 경우) 지도를 다시 만들지 않고 중심/마커 위치만 옮긴다.
  useEffect(() => {
    if (!mapRef.current || !window.naver) return;
    const resolvedLat = centerLat ?? FALLBACK_CENTER.lat;
    const resolvedLng = centerLng ?? FALLBACK_CENTER.lng;
    const center = new window.naver.maps.LatLng(resolvedLat, resolvedLng);
    mapRef.current.setCenter(center);
    companyMarkerRef.current?.setPosition(center);
  }, [centerLat, centerLng]);

  // 식당 마커는 별도 effect로 분리 - restaurants가 바뀔 때(예: 직접 추가 후 새로고침)만 다시 그린다.
  // id별로 markersRef에 저장해둬서, focusTarget effect에서 특정 마커를 다시 찾아 애니메이션을 줄 수 있게 한다.
  useEffect(() => {
    if (!mapRef.current || !window.naver) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = new Map();

    for (const restaurant of restaurants) {
      if (typeof restaurant.lat !== "number" || typeof restaurant.lng !== "number") continue;

      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(restaurant.lat, restaurant.lng),
        map: mapRef.current,
        icon: buildRestaurantMarkerIcon(restaurant),
      });

      if (onMarkerClick) {
        window.naver.maps.Event.addListener(marker, "click", () => onMarkerClick(restaurant));
      }

      markersRef.current.set(restaurant.id, marker);
    }
  }, [restaurants, ready, onMarkerClick]);

  // 리스트에서 "이미 있어요" / 방금 추가한 식당을 눌렀을 때 지도를 그 위치로 이동시키고 마커를 잠깐 튀게 한다.
  useEffect(() => {
    if (!mapRef.current || !focusTarget || !window.naver) return;

    const target = new window.naver.maps.LatLng(focusTarget.lat, focusTarget.lng);
    mapRef.current.setCenter(target);
    mapRef.current.setZoom(18);

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
  const zeroPayBadge = restaurant.isZeroPay
    ? `<span class="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] text-white ring-1 ring-white">₩</span>`
    : "";

  return {
    content: `
      <div class="group relative flex flex-col items-center" style="cursor:pointer;">
        <span class="pointer-events-none absolute -top-7 whitespace-nowrap rounded-full bg-ink px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-soft transition-opacity duration-150 group-hover:opacity-100">
          ${restaurant.name}
        </span>
        <div
          class="relative flex h-8 w-8 items-center justify-center rounded-full text-base shadow-soft ring-2 ring-white transition-transform duration-150 group-hover:scale-125"
          style="background:${visual.color}"
        >
          ${visual.emoji}
          ${zeroPayBadge}
        </div>
      </div>
    `,
    anchor: new window.naver.maps.Point(16, 16),
  };
}
