"use client";

import { useMemo } from "react";
import type { RestaurantSummary } from "@/types";
import { SPECIAL_FILTERS, getAvailableCategoryLabels, type SpecialFilterKey } from "@/lib/restaurant-filters";

interface FilterBarProps {
  restaurants: RestaurantSummary[]; // 필터링 전 전체 목록 - 사용 가능한 카테고리 태그를 뽑는 기준
  activeCategory: string | null;
  activeSpecialFilters: Set<SpecialFilterKey>;
  onToggleCategory: (label: string) => void;
  onToggleSpecialFilter: (key: SpecialFilterKey) => void;
  // 2026-08-06 오후 신규: 지도에서 클러스터 마커를 클릭해 "구역 확대" 상태로 들어갔을 때만 보이는
  // "홈으로" 버튼. 새 절대위치를 따로 잡지 않고 이 컴포넌트(FilterBar)와 같은 위치 앵커를 공유하는
  // 같은 flex 컨테이너 안, 필터 알약 바로 위에 둔다 - 오전에 겪었던 "새 매직넘버 위치 → 다른 요소와
  // 겹침" 회귀를 반복하지 않기 위한 선택.
  homeButtonVisible?: boolean;
  onGoHome?: () => void;
}

// 필터 바. 카테고리 태그(한식/중식/...)는 지금 이 회사 식당 데이터에 실제로 존재하는 카테고리만
// 동적으로 뽑아서 보여준다 (데이터에 없는 카테고리 태그는 아예 안 보임).
//
// 2026-08-06 위치 변경 히스토리 (오전, 3차까지):
// 1차: 지도 위 "상단 중앙"에 화면 전체 폭 기준으로 가운데 정렬 - 사이드바에 가려지는 버그.
// 2차: 사이드바를 피해서 "사이드바 오른쪽 ~ 화면 오른쪽" 구간 안에서만 가운데 정렬 + 데스크톱은
//   지도 하단으로 이동 - 화면이 넓을수록 화면 전체 기준으로는 치우쳐 보인다는 피드백.
// 3차(오전 최종): 화면 전체 기준 진짜 가운데 정렬로 변경. 대신 사이드바보다 z-index를 높게(z-30,
//   사이드바는 z-20) 둬서, 혹시 창을 좁혔을 때 필터 바가 사이드바 영역과 겹치더라도 최소한
//   필터 바가 위로 보이고 버튼이 눌리지 않는 사태는 재발하지 않게 방어함.
// 모바일은 사이드바가 화면 하단 바텀시트라 아예 다른 레이아웃이므로 기존 위치(상단 중앙,
// 화면 전체 폭 기준)를 그대로 유지한다.
//
// 2026-08-06 오후: 지도 클러스터 클릭 시 나타나는 "홈으로" 버튼을 여기(필터 알약 바로 위)에
// 같이 배치하기 위해, 바깥 래퍼를 "flex justify-center"(가로 한 줄)에서
// "flex flex-col items-center gap-2"(세로 스택, 가로는 계속 가운데)로 바꿨다. 이렇게 하면
// 홈 버튼이 있든 없든 필터 알약의 위치 자체는 항상 그대로이고(같은 앵커를 공유), 홈 버튼은
// 그 위에 자연스럽게 얹힌다 - 별도의 절대위치 좌표를 새로 추측할 필요가 없다.
export default function FilterBar({
  restaurants,
  activeCategory,
  activeSpecialFilters,
  onToggleCategory,
  onToggleSpecialFilter,
  homeButtonVisible = false,
  onGoHome,
}: FilterBarProps) {
  // 2026-08-06 저녁 추가: 식당이 많을 때(공공데이터 시딩) 이 계산이 매 렌더마다 전체 배열을
  // 훑는 게 누적되면 부담이 되므로, restaurants가 실제로 바뀔 때만 다시 계산한다.
  const categoryLabels = useMemo(() => getAvailableCategoryLabels(restaurants), [restaurants]);

  if (restaurants.length === 0) return null;

  return (
    <div
      className={[
        // 사이드바(z-20)보다 위에 오도록 z-30 - 화면 전체 기준으로 진짜 가운데 정렬하면 좁은
        // 창 폭에서 사이드바와 겹칠 수 있는데, 그래도 최소한 필터 버튼이 가려져서 안 눌리는
        // 사태는 막기 위함.
        "pointer-events-none absolute z-30 flex flex-col items-center gap-2 px-4",
        // 모바일: 상단 중앙, 화면 전체 폭 기준
        "left-0 right-0 top-14",
        // 데스크톱: 지도 하단, 화면 전체 폭 기준 진짜 가운데 정렬
        "md:left-1/2 md:right-auto md:top-auto md:bottom-6 md:-translate-x-1/2 md:px-0",
      ].join(" ")}
    >
      {homeButtonVisible && (
        <button
          onClick={onGoHome}
          className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-black"
        >
          🏠 전체 지도로 돌아가기
        </button>
      )}

      <div className="pointer-events-auto flex max-w-[92vw] flex-wrap justify-center gap-1.5 rounded-full bg-surface/95 px-3 py-2 shadow-soft backdrop-blur md:max-w-none">
        {categoryLabels.map((label) => (
          <button
            key={label}
            onClick={() => onToggleCategory(label)}
            className={[
              "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition",
              activeCategory === label
                ? "bg-primary text-white"
                : "bg-surface-muted text-ink-soft hover:bg-primary-light",
            ].join(" ")}
          >
            {label}
          </button>
        ))}

        {categoryLabels.length > 0 && <span className="mx-0.5 w-px self-stretch bg-black/10" />}

        {SPECIAL_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onToggleSpecialFilter(f.key)}
            className={[
              "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition",
              activeSpecialFilters.has(f.key)
                ? "bg-primary text-white"
                : "bg-surface-muted text-ink-soft hover:bg-primary-light",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
