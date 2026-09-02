"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import type { RestaurantSummary } from "@/types";

interface BattleRestaurantPickerModalProps {
  open: boolean;
  onClose: () => void;
  restaurants: RestaurantSummary[];
  onPick: (restaurant: {
    id?: string;
    name: string;
    category?: string;
    roadAddress?: string;
    zeroPay?: boolean;
  }) => void;
  onDirectAdd: (name: string, category?: string) => void;
}

export default function BattleRestaurantPickerModal({
  open,
  onClose,
  restaurants,
  onPick,
  onDirectAdd,
}: BattleRestaurantPickerModalProps) {
  const [activeTab, setActiveTab] = useState<"list" | "map">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [directMenuName, setDirectMenuName] = useState("");
  const [directCategory, setDirectCategory] = useState("한식");
  const [selectedMapRestaurant, setSelectedMapRestaurant] = useState<RestaurantSummary | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // 검색 필터링된 식당 목록
  const filteredRestaurants = useMemo(() => {
    if (!searchQuery.trim()) return restaurants.slice(0, 30);
    const q = searchQuery.trim().toLowerCase();
    return restaurants
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.category && r.category.toLowerCase().includes(q)) ||
          (r.address && r.address.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [restaurants, searchQuery]);

  // 지도 초기화 및 마커 렌더링
  useEffect(() => {
    if (!open || activeTab !== "map" || !mapContainerRef.current) return;
    if (typeof window === "undefined" || !window.naver?.maps) return;

    // 기본 중심 좌표 (첫 번째 식당 좌표 또는 기본값)
    const validRestaurant = restaurants.find((r) => r.lat && r.lng);
    const centerLat = validRestaurant ? validRestaurant.lat : 37.5665;
    const centerLng = validRestaurant ? validRestaurant.lng : 126.978;

    const center = new window.naver.maps.LatLng(centerLat, centerLng);
    const map = new window.naver.maps.Map(mapContainerRef.current, {
      center,
      zoom: 16,
      zoomControl: true,
      zoomControlOptions: {
        position: window.naver.maps.Position.TOP_RIGHT,
      },
    });
    mapInstanceRef.current = map;

    // 기존 마커 정리
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    // 유효한 좌표를 가진 식당 마커 생성
    restaurants.forEach((restaurant) => {
      if (!restaurant.lat || !restaurant.lng) return;

      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(restaurant.lat, restaurant.lng),
        map,
        title: restaurant.name,
      });

      window.naver.maps.Event.addListener(marker, "click", () => {
        setSelectedMapRestaurant(restaurant);
        map.panTo(new window.naver.maps.LatLng(restaurant.lat, restaurant.lng));
      });

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [open, activeTab, restaurants]);

  if (!open) return null;

  const handleDirectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directMenuName.trim()) return;
    onDirectAdd(directMenuName.trim(), directCategory);
    setDirectMenuName("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4 backdrop-blur-xs">
      <div className="flex h-[88vh] max-h-[640px] w-full max-w-lg flex-col rounded-2xl border border-black/10 bg-surface text-ink shadow-soft overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3.5 shrink-0 bg-surface">
          <div>
            <h3 className="text-base sm:text-lg font-bold tracking-tight text-ink">메뉴 / 식당 후보 선택</h3>
            <p className="text-xs text-ink-soft">추천할 식당을 고르거나 직접 메뉴를 입력하세요.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-ink-soft hover:bg-surface-muted hover:text-ink transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex border-b border-black/5 bg-surface-muted/50 px-4 pt-2 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab("list")}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition ${
              activeTab === "list"
                ? "border-primary text-primary"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            목록에서 검색
          </button>
          <button
            onClick={() => setActiveTab("map")}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition ${
              activeTab === "map"
                ? "border-primary text-primary"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            지도에서 선택
          </button>
        </div>

        {/* 탭 1: 목록 검색 */}
        {activeTab === "list" && (
          <div className="flex flex-1 flex-col overflow-hidden min-h-0">
            {/* 검색 입력창 */}
            <div className="p-3 border-b border-black/5 bg-surface shrink-0">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="식당명, 카테고리 검색..."
                  className="w-full rounded-xl border border-black/10 bg-surface-muted/50 px-4 py-2 pl-9 text-sm text-ink placeholder-ink-soft focus:border-primary focus:bg-surface focus:outline-none"
                  autoFocus
                />
                <svg
                  className="absolute left-3 top-2.5 h-4 w-4 text-ink-soft"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            {/* 식당 목록 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-surface-muted/30 min-h-0">
              {filteredRestaurants.length > 0 ? (
                filteredRestaurants.map((restaurant) => (
                  <button
                    key={restaurant.id}
                    onClick={() => {
                      onPick({
                        id: restaurant.id,
                        name: restaurant.name,
                        category: restaurant.category || "기타",
                        roadAddress: restaurant.address,
                        zeroPay: restaurant.isZeroPay,
                      });
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-black/5 bg-surface p-3 text-left transition hover:border-primary/40 hover:bg-primary/5 shadow-xs"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-ink text-sm">{restaurant.name}</span>
                        <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-soft">
                          {restaurant.category || "식당"}
                        </span>
                        {restaurant.isZeroPay && (
                          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                            제로페이
                          </span>
                        )}
                      </div>
                      {restaurant.address && (
                        <p className="mt-0.5 truncate text-xs text-ink-soft">{restaurant.address}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      선택
                    </span>
                  </button>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-ink-soft">
                  검색된 등록 식당이 없습니다.
                </div>
              )}
            </div>
          </div>
        )}

        {/* 탭 2: 지도에서 선택 */}
        {activeTab === "map" && (
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-muted/20">
            <div ref={mapContainerRef} className="h-full w-full" />

            {/* 지도 위 식당 선택 카드 팝업 */}
            {selectedMapRestaurant && (
              <div className="absolute bottom-3 left-3 right-3 rounded-2xl border border-black/10 bg-surface p-3.5 shadow-lg flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-ink text-sm sm:text-base">
                      {selectedMapRestaurant.name}
                    </span>
                    <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-soft">
                      {selectedMapRestaurant.category || "식당"}
                    </span>
                    {selectedMapRestaurant.isZeroPay && (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        제로페이
                      </span>
                    )}
                  </div>
                  {selectedMapRestaurant.address && (
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      {selectedMapRestaurant.address}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setSelectedMapRestaurant(null)}
                    className="rounded-xl border border-black/10 px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface-muted"
                  >
                    닫기
                  </button>
                  <button
                    onClick={() => {
                      onPick({
                        id: selectedMapRestaurant.id,
                        name: selectedMapRestaurant.name,
                        category: selectedMapRestaurant.category || "기타",
                        roadAddress: selectedMapRestaurant.address,
                        zeroPay: selectedMapRestaurant.isZeroPay,
                      });
                      onClose();
                    }}
                    className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-primary-dark shadow-xs"
                  >
                    후보로 선택
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 직접 입력하기 (하단 공통 고정) */}
        <form onSubmit={handleDirectSubmit} className="border-t border-black/5 bg-surface p-3 shrink-0">
          <div className="text-xs font-semibold text-ink mb-1.5">원하는 메뉴 직접 추가하기</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={directMenuName}
              onChange={(e) => setDirectMenuName(e.target.value)}
              placeholder="예: 구내식당 샐러드, 배달 떡볶이"
              className="flex-1 rounded-xl border border-black/10 bg-surface-muted/50 px-3 py-2 text-xs sm:text-sm text-ink placeholder-ink-soft focus:border-primary focus:bg-surface focus:outline-none"
            />
            <select
              value={directCategory}
              onChange={(e) => setDirectCategory(e.target.value)}
              className="rounded-xl border border-black/10 bg-surface-muted/50 px-2.5 py-2 text-xs sm:text-sm text-ink focus:border-primary focus:bg-surface focus:outline-none shrink-0"
            >
              <option value="한식">한식</option>
              <option value="중식">중식</option>
              <option value="일식">일식</option>
              <option value="양식">양식</option>
              <option value="분식">분식</option>
              <option value="샐러드/간편식">샐러드</option>
              <option value="기타">기타</option>
            </select>
            <button
              type="submit"
              disabled={!directMenuName.trim()}
              className="rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white transition hover:bg-primary-dark disabled:opacity-40 shrink-0"
            >
              추가
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
