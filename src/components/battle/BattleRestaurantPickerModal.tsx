"use client";

import { useState, useMemo } from "react";
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
  const [query, setQuery] = useState("");
  const [directCategory, setDirectCategory] = useState("한식");

  const filteredRestaurants = useMemo(() => {
    if (!query.trim()) return restaurants.slice(0, 20);
    const q = query.trim().toLowerCase();
    return restaurants
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.category && r.category.toLowerCase().includes(q)) ||
          (r.address && r.address.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [restaurants, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-100 shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-white">메뉴 / 식당 후보 선택</h3>
            <p className="text-xs text-neutral-400">내가 추천할 식당을 검색하거나 직접 입력하세요.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 검색 입력창 */}
        <div className="p-4 border-b border-neutral-800">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="식당명, 카테고리 검색..."
              className="w-full rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 pl-10 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <svg
              className="absolute left-3.5 top-3 h-4 w-4 text-neutral-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* 식당 목록 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
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
                className="flex w-full items-center justify-between rounded-xl border border-neutral-800/80 bg-neutral-800/40 p-3 text-left transition hover:border-neutral-700 hover:bg-neutral-800"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-neutral-100">{restaurant.name}</span>
                    <span className="rounded bg-neutral-700/60 px-1.5 py-0.5 text-[11px] text-neutral-300">
                      {restaurant.category || "식당"}
                    </span>
                    {restaurant.isZeroPay && (
                      <span className="rounded bg-emerald-950/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-800/50">
                        제로페이
                      </span>
                    )}
                  </div>
                  {restaurant.address && (
                    <p className="mt-0.5 truncate text-xs text-neutral-400">{restaurant.address}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-lg bg-blue-600/20 px-2.5 py-1 text-xs font-semibold text-blue-400 border border-blue-500/30">
                  선택
                </span>
              </button>
            ))
          ) : (
            <div className="py-8 text-center text-sm text-neutral-400">
              검색된 등록 식당이 없습니다.
            </div>
          )}
        </div>

        {/* 직접 입력하기 */}
        <div className="border-t border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs font-semibold text-neutral-400 mb-2">원하는 메뉴 직접 추가하기</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 구내식당 샐러드, 배달 떡볶이"
              className="flex-1 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={directCategory}
              onChange={(e) => setDirectCategory(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
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
              onClick={() => {
                if (query.trim()) {
                  onDirectAdd(query.trim(), directCategory);
                  onClose();
                }
              }}
              disabled={!query.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
