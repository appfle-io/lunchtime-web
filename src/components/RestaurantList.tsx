"use client";

import { useState } from "react";
import BottomSheet from "./BottomSheet";

interface RestaurantListProps {
  companyCode: string;
}

type FilterKey = "zeropay" | "walk5" | "today" | "recent";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "zeropay", label: "제로페이" },
  { key: "walk5", label: "도보 5분" },
  { key: "today", label: "오늘추천" },
  { key: "recent", label: "최근방문" },
];

// TODO: companyCode 기준 /api/restaurants 연동, 활성 필터 상태를 쿼리스트링/서버 컴포넌트로 전달.
// TODO: "오늘 뭐 먹지?" 버튼 클릭 시 룰렛/카드 스와이프 인터랙션 + /api/recommend(Gemini) 호출.
export default function RestaurantList({ companyCode }: RestaurantListProps) {
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());

  function toggleFilter(key: FilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <BottomSheet title="주변 식당">
      <div className="flex flex-wrap gap-2 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleFilter(f.key)}
            className={[
              "rounded-full px-3 py-1.5 text-sm font-medium transition",
              activeFilters.has(f.key)
                ? "bg-primary text-white"
                : "bg-surface-muted text-ink-soft hover:bg-primary-light",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button className="mb-4 w-full rounded-xl2 bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black">
        🎲 오늘 뭐 먹지?
      </button>

      {/* 임시 placeholder - 실제 목록은 API 연동 후 restaurant.map(...)으로 교체 */}
      <ul className="flex flex-col gap-3">
        <li className="rounded-xl2 border border-black/5 p-4 text-sm text-ink-soft">
          {companyCode} 근처 식당 데이터가 아직 없어요. 관리자 시딩이 필요합니다.
        </li>
      </ul>
    </BottomSheet>
  );
}
