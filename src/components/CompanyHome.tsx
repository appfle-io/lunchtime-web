"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MapView from "./MapView";
import RestaurantList from "./RestaurantList";
import RestaurantDetail from "./RestaurantDetail";
import Toast from "./Toast";
import type { RestaurantSummary } from "@/types";

interface CompanyHomeProps {
  companyCode: string;
  centerLat?: number;
  centerLng?: number;
  restaurants: RestaurantSummary[];
  nickname: string;
}

export interface FocusTarget {
  id: string;
  lat: number;
  lng: number;
}

// 지도(MapView)와 리스트(RestaurantList)는 형제 컴포넌트라 서로 직접 통신할 수 없다.
// 이 클라이언트 컴포넌트가 "지금 포커스해야 할 식당", "상세 모달로 열려있는 식당", "토스트 메시지"
// 상태를 들고 있으면서 둘을 이어준다.
// (page.tsx는 async 서버 컴포넌트라 useState를 못 쓰기 때문에, 데이터 페칭/세션 체크는 page.tsx에서 하고
//  상태 관리는 이 컴포넌트로 넘겨받는 구조.)
export default function CompanyHome({
  companyCode,
  centerLat,
  centerLng,
  restaurants,
  nickname,
}: CompanyHomeProps) {
  const router = useRouter();
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantSummary | null>(null);

  function focusRestaurant(restaurant: RestaurantSummary) {
    if (typeof restaurant.lat !== "number" || typeof restaurant.lng !== "number") return;
    // 매번 새 객체를 만들어서, 같은 식당을 두 번 연속 눌러도 MapView의 effect가 다시 실행되게 한다.
    setFocusTarget({ id: restaurant.id, lat: restaurant.lat, lng: restaurant.lng });
  }

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.refresh();
  }

  return (
    <main className="relative h-screen w-full overflow-hidden">
      <MapView
        companyCode={companyCode}
        centerLat={centerLat}
        centerLng={centerLng}
        restaurants={restaurants}
        focusTarget={focusTarget}
        onMarkerClick={setSelectedRestaurant}
      />
      <RestaurantList
        companyCode={companyCode}
        restaurants={restaurants}
        onFocusRestaurant={focusRestaurant}
        onSelectRestaurant={setSelectedRestaurant}
        onNotify={setToastMessage}
      />
      <RestaurantDetail
        restaurant={selectedRestaurant}
        companyCode={companyCode}
        nickname={nickname}
        onClose={() => setSelectedRestaurant(null)}
      />
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />

      {/* 로그인된 사용자 배지 + 로그아웃. 지도 위 좌상단에 고정. */}
      <button
        onClick={handleLogout}
        className="absolute left-4 top-4 z-30 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft shadow-soft transition hover:text-primary-dark md:left-[26rem]"
      >
        {nickname}님 · 로그아웃
      </button>
    </main>
  );
}
