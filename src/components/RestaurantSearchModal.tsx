"use client";

import { useEffect, useMemo, useState } from "react";
import type { RestaurantSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";

interface RestaurantSearchModalProps {
  open: boolean;
  // 2026-08-08 신규: 필터바/클러스터/지도 뷰포트로 좁혀지기 전, 회사 식당 전체(실시간 제로페이
  // 갱신 포함, CompanyHome의 restaurants state)를 받는다 - "돋보기 검색"은 지금 화면에 뭐가
  // 보이는지와 무관하게 회사에 등록된 모든 가맹점을 대상으로 찾아야 의미가 있다.
  allRestaurants: RestaurantSummary[];
  onClose: () => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
}

const MAX_RESULTS = 30;

// 2026-08-08 신규: 돋보기(🔍) 검색 모달. 리스트를 스크롤하지 않고 이름으로 바로 찾아서, 클릭하면
// 그 가맹점의 상세모달을 열고 지도 포커스도 그쪽으로 옮긴다(다른 포커스 이동 경로와 동일하게
// CompanyHome의 focusRestaurant/handleSelectRestaurant를 그대로 재사용 - MapView가 focusTarget을
// 받으면 그 가맹점을 클러스터에서 제외하고 확대된 마커로 보여주는 로직도 자동으로 같이 적용된다).
export default function RestaurantSearchModal({
  open,
  allRestaurants,
  onClose,
  onFocusRestaurant,
  onSelectRestaurant,
}: RestaurantSearchModalProps) {
  const [query, setQuery] = useState("");

  // 모달을 열 때마다 이전 검색어를 지운다.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // 상호명(네이버명, 제로페이 공식명, 사업자등록명 포함)이 먼저 일치하는 것을 우선으로,
  // 상호명에는 없지만 주소(랜드마크 등)에 일치하는 것을 그 다음으로 보여준다.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s/g, "");
    if (!q) return [];

    const byDistance = (a: RestaurantSummary, b: RestaurantSummary) =>
      (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);

    const matchesName = (r: RestaurantSummary) => {
      const names = [
        r.name,
        r.displayName,
        r.naverMatchedName,
        r.zeroPayOfficialName,
        r.businessName,
      ].filter(Boolean) as string[];

      return names.some((n) => n.toLowerCase().replace(/\s/g, "").includes(q));
    };

    const nameMatches = allRestaurants
      .filter((r) => matchesName(r))
      .sort(byDistance);
    const addressOnlyMatches = allRestaurants
      .filter(
        (r) =>
          !matchesName(r) &&
          r.address.toLowerCase().replace(/\s/g, "").includes(q)
      )
      .sort(byDistance);

    return [...nameMatches, ...addressOnlyMatches].slice(0, MAX_RESULTS);
  }, [query, allRestaurants]);

  if (!open) return null;

  function handlePick(restaurant: RestaurantSummary) {
    onFocusRestaurant?.(restaurant);
    onSelectRestaurant?.(restaurant);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-20 sm:pt-28"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-md flex-col gap-3 overflow-hidden rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">🔍 가맹점 검색</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="식당 이름으로 검색"
          autoFocus
          className="w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-primary"
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!query.trim() && (
            <p className="py-6 text-center text-sm text-ink-soft">가맹점 이름을 입력해서 찾아보세요.</p>
          )}
          {query.trim() && results.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-soft">일치하는 가맹점이 없어요.</p>
          )}
          {results.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {results.map((r) => {
                const visual = getCategoryVisual(r.category, r.categoryLabel);
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => handlePick(r)}
                      className="flex w-full items-center gap-2.5 rounded-xl border border-black/10 p-2.5 text-left transition hover:border-primary"
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
                        style={{ background: visual.color }}
                      >
                        {visual.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                        {(r.zeroPayOfficialName || r.businessName) &&
                          (r.zeroPayOfficialName !== r.name || r.businessName !== r.name) && (
                            <p className="truncate text-[11px] text-emerald-700 font-medium">
                              {r.zeroPayOfficialName && r.zeroPayOfficialName !== r.name
                                ? `제로페이 명칭: ${r.zeroPayOfficialName}`
                                : r.businessName && r.businessName !== r.name
                                ? `사업자 명칭: ${r.businessName}`
                                : ""}
                            </p>
                          )}
                        <p className="truncate text-xs text-ink-soft">{r.address}</p>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {typeof r.distanceMeters === "number" && (
                          <span className="whitespace-nowrap text-xs text-ink-soft">
                            {r.distanceMeters}m
                          </span>
                        )}
                        {r.isZeroPay && (
                          <span className="whitespace-nowrap rounded-full bg-primary-light px-1.5 py-0.5 text-[10px] text-primary-dark">
                            제로페이
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {results.length === MAX_RESULTS && (
            <p className="mt-2 text-center text-[11px] text-ink-soft">
              결과가 많아 상위 {MAX_RESULTS}개만 보여드려요. 검색어를 더 구체적으로 입력해보세요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
