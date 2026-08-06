"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "./BottomSheet";
import type { RestaurantSummary } from "@/types";

interface RestaurantListProps {
  companyCode: string;
  restaurants: RestaurantSummary[];
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
  onNotify?: (message: string) => void;
}

type FilterKey = "zeropay" | "walk5" | "today" | "recent";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "zeropay", label: "제로페이" },
  { key: "walk5", label: "도보 5분" },
  { key: "today", label: "오늘추천" },
  { key: "recent", label: "최근방문" },
];

// TODO: "오늘 뭐 먹지?" 버튼 클릭 시 룰렛/카드 스와이프 인터랙션 + /api/recommend(Gemini) 호출.
// TODO: 지도 마커 클릭 시 이 리스트에서 해당 항목 하이라이트/스크롤 (지금은 리스트 -> 지도 방향만 연결됨)
export default function RestaurantList({
  companyCode,
  restaurants,
  onFocusRestaurant,
  onSelectRestaurant,
  onNotify,
}: RestaurantListProps) {
  const router = useRouter();
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addAddressHint, setAddAddressHint] = useState("");
  const [addStatus, setAddStatus] = useState<"idle" | "loading" | "error">("idle");
  const [addError, setAddError] = useState<string | null>(null);

  function toggleFilter(key: FilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const filtered = restaurants.filter((r) => {
    if (activeFilters.has("zeropay") && !r.isZeroPay) return false;
    if (activeFilters.has("walk5") && (r.distanceMeters ?? Infinity) > 400) return false;
    // "오늘추천"/"최근방문"은 추천 로직/히스토리 기능이 아직 없어서 TODO로 남겨둠.
    return true;
  });

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;

    setAddStatus("loading");
    setAddError(null);

    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          name: addName.trim(),
          addressHint: addAddressHint.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAddStatus("error");
        setAddError(data.error ?? "식당을 추가하지 못했어요.");
        return;
      }

      const { restaurant, existing } = data as {
        restaurant: RestaurantSummary;
        existing: boolean;
      };

      setAddStatus("idle");
      setAddName("");
      setAddAddressHint("");

      if (existing) {
        // 이미 있는 식당이면 새로 만들지 않고, 토스트로 알려준 다음 지도만 그 위치로 이동시킨다.
        onNotify?.(`"${restaurant.name}"은 이미 목록에 있어요.`);
        onFocusRestaurant?.(restaurant);
      } else {
        setShowAddForm(false);
        router.refresh(); // 서버 컴포넌트를 다시 실행해서 방금 추가한 식당을 목록에 반영
        onNotify?.(`"${restaurant.name}"을 추가했어요.`);
        onFocusRestaurant?.(restaurant);
      }
    } catch {
      setAddStatus("error");
      setAddError("네트워크 오류로 추가하지 못했어요. 다시 시도해줘.");
    }
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

      <button className="mb-3 w-full rounded-xl2 bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black">
        🎲 오늘 뭐 먹지?
      </button>

      {/* 자동 시딩에서 빠진 식당을 직접 추가하는 기능. 스크롤 없이 바로 보이도록 리스트 맨 위에 배치. */}
      {showAddForm ? (
        <form
          onSubmit={handleAddSubmit}
          className="mb-4 flex flex-col gap-2 rounded-xl2 border border-black/10 p-4"
        >
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="식당 이름 (예: 영등포신세계 OO식당)"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            autoFocus
          />
          <input
            value={addAddressHint}
            onChange={(e) => setAddAddressHint(e.target.value)}
            placeholder="위치 힌트 (선택, 예: 신세계백화점 영등포점 지하)"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          {addError && <p className="text-xs text-primary-dark">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={addStatus === "loading"}
              className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {addStatus === "loading" ? "찾는 중..." : "추가하기"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted"
            >
              취소
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="mb-4 w-full rounded-xl2 border border-dashed border-black/15 px-4 py-3 text-sm font-medium text-ink-soft transition hover:border-primary hover:text-primary"
        >
          + 여기 없는 식당 직접 추가하기
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="mb-4 rounded-xl2 border border-black/5 p-4 text-sm text-ink-soft">
          {restaurants.length === 0
            ? `${companyCode} 근처 식당 데이터가 아직 없어요. 관리자 시딩이 필요합니다.`
            : "이 필터에 맞는 식당이 없어요."}
        </div>
      ) : (
        <ul className="mb-4 flex flex-col gap-3">
          {filtered.map((r) => (
            <li
              key={r.id}
              onClick={() => {
                onFocusRestaurant?.(r);
                onSelectRestaurant?.(r);
              }}
              className="cursor-pointer rounded-xl2 border border-black/5 p-4 transition hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{r.name}</p>
                  <p className="text-xs text-ink-soft">{r.address}</p>
                </div>
                {typeof r.distanceMeters === "number" && (
                  <span className="whitespace-nowrap text-xs text-ink-soft">{r.distanceMeters}m</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.category && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
                    {r.category}
                  </span>
                )}
                {r.isZeroPay && (
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary-dark">
                    제로페이
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
