"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { RestaurantSummary } from "@/types";

declare global {
  interface Window {
    naver: any;
  }
}

interface MapViewProps {
  companyCode: string;
}

// 네이버 지도(NCP Maps)를 쓰되, 기본 UI 느낌이 나지 않도록 스타일링 레이어를 별도로 관리한다.
// - 지도 색감: NCP 콘솔의 Map Style Editor에서 만든 커스텀 스타일 ID를 적용 (아래 mapStyleId)
// - 마커: 기본 빨간 핀 대신 카테고리 아이콘이 들어간 커스텀 SVG 마커로 교체
// TODO: companyCode로 회사 중심좌표 조회, 반경 내 식당 목록 API 연동, 제로페이 가맹점 색상 구분
export default function MapView({ companyCode }: MapViewProps) {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || !mapElRef.current || !window.naver) return;

    // 임시 중심좌표 (서울시청) - 실제로는 companyCode로 회사 중심좌표를 조회해서 사용
    const center = new window.naver.maps.LatLng(37.5665, 126.978);

    mapRef.current = new window.naver.maps.Map(mapElRef.current, {
      center,
      zoom: 16,
      // NCP 콘솔 > Map Style Editor에서 발급한 커스텀 스타일 ID로 교체
      // customStyleId: process.env.NEXT_PUBLIC_NAVER_MAP_STYLE_ID,
      zoomControl: false,
    });

    // 회사 위치 마커 예시 - 커스텀 HTML 오버레이 (기본 빨간 핀 대신)
    new window.naver.maps.Marker({
      position: center,
      map: mapRef.current,
      icon: {
        content: `<div class="rounded-full bg-primary text-white text-xs font-semibold px-2 py-1 shadow-soft">회사</div>`,
        anchor: new window.naver.maps.Point(20, 10),
      },
    });
  }, [ready, companyCode]);

  return (
    <>
      <Script
        src={`https://openapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID}`}
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={mapElRef} className="absolute inset-0 z-0 h-full w-full" />
    </>
  );
}

// 식당 마커를 카테고리별 커스텀 아이콘 + 제로페이 여부 색상으로 그리는 헬퍼.
// MapView 본체에서 restaurants 목록을 받으면 이 함수로 마커를 일괄 생성한다.
export function buildRestaurantMarkerIcon(restaurant: RestaurantSummary) {
  const color = restaurant.isZeroPay ? "#FF5D39" : "#9CA3AF";
  return {
    content: `
      <div style="background:${color}" class="flex items-center justify-center rounded-full w-8 h-8 text-white text-[10px] font-bold shadow-soft">
        ${restaurant.category?.slice(0, 1) ?? "🍚"}
      </div>
    `,
  };
}
