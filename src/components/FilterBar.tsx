"use client";

import { useMemo, useState } from "react";
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
//
// 2026-08-10 신규: 모바일은 화면이 좁아서 카테고리 태그(동적, 개수 많음) + 특수 태그 5개가 다
// 펼쳐지면 필터 알약이 2~3줄까지 늘어나 지도를 많이 가렸다. "제로페이"만 항상 보이는 필수
// 태그로 남기고 나머지(카테고리 전체 + 제로페이 외 특수 태그)는 "더보기"로 접어서, 기본 상태는
// 한 줄로 가볍게 유지한다. 데스크톱은 화면이 넓어서 그대로 다 펼쳐서 보여준다(expanded 상태와
// 무관하게 md: 브레이크포인트에서 항상 보이도록 처리).
//
// 2026-08-10 2차 수정: 데스크톱에서 "필터 위치가 항상 지도의 중심으로 오게 해달라"는 요청.
// 이전엔 md:left-1/2 + -translate-x-1/2로 "화면 전체 폭 기준" 가운데였는데, MapView.tsx가
// 지도 컨테이너를 md:left-[448px]부터 시작하게 만들어둔 뒤로는(좌측 사이드바 카드가 그 앞을
// 절대좌표로 덮고 있음) 화면 전체 기준 가운데 ≠ 실제 눈에 보이는 지도 영역의 가운데였다.
// "보이는 지도 영역"은 [448px, 100vw] 구간이므로, 그 구간의 가운데는 448px + (100vw-448px)/2
// = 50vw + 224px (224 = 448/2). left-1/2(=50%, 부모가 전체 뷰포트 폭이라 50vw와 동일)을
// calc(50%+224px)로 바꾸면 창 폭이 바뀌어도(리사이즈) 순수 CSS 계산이라 항상 다시 맞다 -
// 별도의 리사이즈 이벤트 리스너가 필요 없다. 448px 값은 MapView.tsx의 지도 컨테이너 오프셋과
// 반드시 같이 바뀌어야 하는 매직넘버 - 그쪽을 바꾸면 이 224px(=448/2)도 같이 바꿔야 한다.
// 2026-08-11 신규: 선택된 필터와 아닌 필터가 한눈에 구분되게 하는 공통 스타일 헬퍼. 예전엔
// 선택 여부와 무관하게 둘 다 옅은 배경(bg-surface-muted)에 테두리가 없어서 알약끼리도, 알약과
// 뒷배경(bg-surface/95)도 잘 구분이 안 됐다(사용자가 스크린샷으로 "안 이쁘다"고 지적). 이제
// 선택 안 된 알약은 옅은 테두리로 경계를 뚜렷하게 주고, 선택된 알약은 진한 배경+테두리+굵은 글씨+
// 체크마크(✓)까지 붙여서 "켜져 있다"는 게 색약/저채도 화면에서도 확실히 보이게 한다.
function filterChipClassName(active: boolean) {
  return [
    "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition",
    active
      ? "border-primary bg-primary text-white font-semibold shadow-sm"
      : "border-black/10 bg-surface text-ink-soft hover:border-primary/50 hover:bg-primary-light",
  ].join(" ");
}

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

  // 2026-08-10 신규: 모바일 "더보기" 접힘 상태. 데스크톱에서는 이 값과 무관하게 항상 펼쳐서 보여준다.
  const [expanded, setExpanded] = useState(false);
  const zeroPayFilter = SPECIAL_FILTERS.find((f) => f.key === "zeropay")!;
  const restSpecialFilters = SPECIAL_FILTERS.filter((f) => f.key !== "zeropay");
  // 접힌 상태에서도 "숨겨진 필터 중 뭔가 켜져 있다"는 걸 알 수 있도록 "더보기" 배지에 개수를 표시.
  const hiddenActiveCount =
    (activeCategory ? 1 : 0) + restSpecialFilters.filter((f) => activeSpecialFilters.has(f.key)).length;

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
        // 데스크톱: 지도 하단, "보이는 지도 영역"([448px, 100vw]) 기준 가운데 정렬.
        // 448 = MapView.tsx 지도 컨테이너의 md:left-[448px]과 반드시 같은 값 - 그쪽이 바뀌면
        // 224(=448/2)도 같이 바꿔야 한다.
        "md:left-[calc(50%+224px)] md:right-auto md:top-auto md:bottom-6 md:-translate-x-1/2 md:px-0",
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

      <div className="pointer-events-auto flex max-w-[92vw] flex-wrap items-center justify-center gap-1.5 rounded-full bg-surface/95 px-3 py-2 shadow-soft backdrop-blur md:max-w-none">
        {/* 제로페이는 모바일에서도 항상 보이는 필수 태그 - 나머지(카테고리/다른 특수태그)와 분리해서
            "더보기"로 접었을 때도 이것만은 계속 눌러서 켤 수 있게 한다.
            2026-08-11: 예전엔 아래 collapsible <div>가 데스크톱에서도 하나의 flex item으로 통째로
            취급돼서, 그 div가 이 버튼 옆 남는 공간에 다 안 들어가면 제로페이만 혼자 첫 줄에 고립되고
            나머지 태그 전부가 다음 줄로 밀려나 어색해 보였다(사용자가 스크린샷으로 지적한 문제).
            아래 collapsible 그룹을 display:contents로 바꿔서 해결함(더 아래 주석 참고). */}
        <button
          onClick={() => onToggleSpecialFilter(zeroPayFilter.key)}
          className={filterChipClassName(activeSpecialFilters.has(zeroPayFilter.key))}
        >
          {activeSpecialFilters.has(zeroPayFilter.key) && "✓ "}
          {zeroPayFilter.label}
        </button>

        {/* 2026-08-10 신규: "더보기"는 모바일에서만 보이는 토글 - 데스크톱은 항상 전부 펼쳐진
            상태라 접었다 펼 필요가 없다. */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 whitespace-nowrap rounded-full border border-black/10 bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-primary/50 hover:bg-primary-light md:hidden"
        >
          {expanded ? "접기" : "더보기"}
          {!expanded && hiddenActiveCount > 0 && (
            <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
              {hiddenActiveCount}
            </span>
          )}
          <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>

        {/* 카테고리 + 제로페이 외 특수태그 - 모바일은 expanded일 때만, 데스크톱은 항상 보임.
            2026-08-11: 이 그룹을 감싸던 <div>가 데스크톱에서 "제로페이" 버튼과 별개의 flex item으로
            통째로 줄바꿈되면서, 제로페이만 혼자 첫 줄에 남고 나머지가 전부 다음 줄로 밀려나 보이는
            문제가 있었다. display:contents로 이 <div> 자체를 박스 모델에서 없애면, 안에 있는
            버튼들이 바깥 컨테이너의 flex-wrap에 직접 참여하게 되어 제로페이/카테고리/나머지
            특수태그가 전부 하나의 흐름으로 자연스럽게 줄바꿈된다(hidden은 그대로 display:none이라
            접힌 상태에서는 여전히 전부 안 보인다). */}
        <div className={[expanded ? "contents" : "hidden", "md:contents"].join(" ")}>
          {categoryLabels.map((label) => (
            <button
              key={label}
              onClick={() => onToggleCategory(label)}
              className={filterChipClassName(activeCategory === label)}
            >
              {activeCategory === label && "✓ "}
              {label}
            </button>
          ))}

          {categoryLabels.length > 0 && <span className="mx-0.5 w-px self-stretch bg-black/10" />}

          {restSpecialFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => onToggleSpecialFilter(f.key)}
              className={filterChipClassName(activeSpecialFilters.has(f.key))}
            >
              {activeSpecialFilters.has(f.key) && "✓ "}
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
