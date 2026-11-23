"use client";

import { useMemo } from "react";
import type { RestaurantSummary } from "@/types";
import type { PopularEntry } from "@/lib/popular-server";
import type { VisitEntry } from "@/lib/meal-stats-server";
import Icon from "./ui/Icon";

interface PopularWidgetProps {
  entries: PopularEntry[]; // 최근 24시간 조회 순위 (사람·식당·하루당 1번만 셈)
  visits: VisitEntry[]; // 최근 7일 "오늘 여기서 먹었어요" 기록 순위
  restaurants: RestaurantSummary[]; // id -> 이름 조회용. 필터 적용 전 전체 목록을 받는다.
  onSelect?: (restaurant: RestaurantSummary) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const SHOW_COUNT = 3;
// 한 번뿐인 기록/한 사람만 본 곳은 "많이" 간/본 식당이 아니다.
const MIN_COUNT = 2;

type Row = { restaurantId: string; count: number };

// 데스크톱 지도 오른쪽 위 인기 식당 카드. 모바일은 화면이 좁아 보여 주지 않는다.
// 실제로 간 기록(최근 7일 많이 간 식당)을 먼저 보여 주고, 그게 부족하면 조회 기준(최근 24시간 많이 본 식당).
// 조회수만으로는 실사용이 적을 때 순위가 거의 생기지 않았다 (2026-11 운영 데이터: 30일간 점심시간 조회 0일).
export default function PopularWidget({
  entries,
  visits,
  restaurants,
  onSelect,
  onRefresh,
  isRefreshing,
}: PopularWidgetProps) {
  const restaurantById = useMemo(() => new Map(restaurants.map((r) => [r.id, r])), [restaurants]);

  // 삭제·숨김 처리된 식당은 건너뛰고 나서 3개를 고른다.
  const pick = useMemo(
    () => (rows: Row[]) =>
      rows
        .filter((x) => x.count >= MIN_COUNT)
        .map((x) => ({ ...x, restaurant: restaurantById.get(x.restaurantId) }))
        .filter((x): x is Row & { restaurant: RestaurantSummary } =>
          Boolean(x.restaurant && x.restaurant.isActive !== false)
        )
        .slice(0, SHOW_COUNT),
    [restaurantById]
  );

  const visitTop = useMemo(
    () => pick(visits.map((v) => ({ restaurantId: v.restaurantId, count: v.visitCount }))),
    [pick, visits]
  );
  const viewTop = useMemo(
    () => pick(entries.map((e) => ({ restaurantId: e.restaurantId, count: e.clickCount }))),
    [pick, entries]
  );

  const useVisits = visitTop.length > 0;
  const top = useVisits ? visitTop : viewTop;
  if (top.length === 0) return null;

  return (
    <div className="hidden z-20 w-56 rounded-xl2 bg-surface/95 p-3 shadow-soft backdrop-blur md:absolute md:block md:bottom-auto md:right-6 md:top-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-ink">{useVisits ? "동료들이 많이 간 식당" : "많이 본 식당"}</p>
          <p className="text-xs text-ink-soft">{useVisits ? "최근 7일 밥 기록 기준" : "최근 24시간"}</p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-muted disabled:opacity-50"
            aria-label="새로고침"
          >
            <Icon name="refresh" className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {top.map(({ restaurantId, count, restaurant }, index) => (
          <li key={restaurantId}>
            <button
              onClick={() => onSelect?.(restaurant)}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition hover:bg-surface-muted"
            >
              <span className="font-bold text-primary">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{restaurant.name}</span>
              <span className="shrink-0 text-xs text-ink-soft">{useVisits ? `${count}번` : `${count}명`}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
