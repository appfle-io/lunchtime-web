"use client";

import { useMemo } from "react";
import type { RestaurantSummary } from "@/types";
import type { PopularEntry } from "@/lib/popular-server";

interface PopularWidgetProps {
  entries: PopularEntry[]; // 이미 상위 3개로 잘려서 들어옴 (2026-08-06: 로그인 1회 + 업무시간 정각에만 갱신)
  restaurants: RestaurantSummary[]; // id -> 이름/카테고리 조회용. 필터 적용 전 전체 목록을 받는다.
  onSelect?: (restaurant: RestaurantSummary) => void;
  onRefresh?: () => void; // 새로고침 버튼 클릭 핸들러 (2026-08-06 신규)
  isRefreshing?: boolean; // 새로고침 진행 중 표시용
}

// 실시간 인기 Top3 카드.
// 2026-08-06 위치 변경 히스토리:
// 1차: "좌측 리스트 사이드바를 피해서"라는 이유로 bottom-[34vh] left-4 / md:bottom-6 md:left-[26rem]
//   같은 값으로 배치 - 사이드바 폭(360px)에 맞춰 계산된 매직 넘버였고, 사이드바를 400px로 넓히자
//   바로 어긋났음.
// 2차: 화면 우상단 코너로 이동(로그아웃 배지와 대칭), 모바일은 top-28로 FilterBar를 피함 - 그런데
//   이것도 "FilterBar가 몇 줄로 접힐지"를 top-28이라는 고정 숫자로 예측한 것이었어서, 실제로
//   카테고리/특수필터가 2줄로 접히는 상황에서 Top3 위젯이 FilterBar 둘째 줄 버튼을 가리는 문제가
//   스크린샷으로 확인됨(2026-08-06). FilterBar가 몇 줄이 될지는 카테고리 개수에 따라 계속
//   달라질 수 있는 값이라 애초에 고정 숫자로 예측하려던 접근 자체가 잘못이었음.
// 3차: 모바일에서는 FilterBar와 아예 다른 영역(화면 하단)으로 옮겨서 카테고리가 몇 줄로
//   접히든 절대 겹치지 않게 함 - BottomSheet의 접힌 높이 바로 위에 배치했었음.
// 4차(현재): "모바일에서는 실시간현황 안 보여줘도 된다"는 요청으로 모바일에서는 아예 렌더링하지
//   않는다(hidden md:block) - 화면이 좁아서 지도/필터/주변식당만으로도 이미 빽빽했다. 데스크톱은
//   FilterBar가 지도 하단 중앙으로 옮겨가서(FilterBar.tsx 참고) 상단이 비므로 그대로 우상단
//   (로그아웃 배지와 대칭, md:top-6 md:right-6) 유지.
export default function PopularWidget({
  entries,
  restaurants,
  onSelect,
  onRefresh,
  isRefreshing,
}: PopularWidgetProps) {
  // 2026-08-06 저녁 추가: 식당이 많을 때 이 Map을 매 렌더마다 새로 만드는 비용이 누적되므로,
  // restaurants가 실제로 바뀔 때만 다시 만든다(위젯은 top3만 보여주지만 조회 대상은 전체 목록).
  const restaurantById = useMemo(() => new Map(restaurants.map((r) => [r.id, r])), [restaurants]);

  if (entries.length === 0) return null;

  return (
    <div className="hidden z-20 w-56 rounded-xl2 bg-surface/95 p-3 shadow-soft backdrop-blur md:absolute md:block md:bottom-auto md:right-6 md:top-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-soft">🔥 실시간 인기 Top3</p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-ink-soft transition hover:bg-surface-muted disabled:opacity-50"
            aria-label="인기 Top3 새로고침"
          >
            {isRefreshing ? "새로고침 중..." : "↻ 새로고침"}
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {entries.map((entry, index) => {
          const restaurant = restaurantById.get(entry.restaurantId);
          if (!restaurant) return null; // 클릭 이후 삭제된 식당 등 - 조용히 건너뜀

          return (
            <li key={entry.restaurantId}>
              <button
                onClick={() => onSelect?.(restaurant)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition hover:bg-surface-muted"
              >
                <span className="font-bold text-primary">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{restaurant.name}</span>
                <span className="shrink-0 text-[10px] text-ink-soft">{entry.clickCount}회</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
