"use client";

import type { CurrentWeather } from "@/lib/weather";

interface WeatherWidgetProps {
  weather: CurrentWeather | null;
  // 2026-08-12 신규: 눌렀을 때 수동으로 다시 불러오는 핸들러. PopularWidget의 onRefresh와
  // 동일한 패턴 - 안 넘겨주면(onRefresh가 없으면) 그냥 눌리지 않는 정보 표시로만 동작한다.
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

// 회사 주변 날씨 위젯 (2026-08-12 신규). 지도 위 오버레이.
// - 데스크톱: 지도 중앙 상단. MapView.tsx가 지도 컨테이너를 md:left-[448px]부터 시작시키므로
//   "보이는 지도 영역"([448px, 100vw])의 정가운데는 md:left-[calc(50%+224px)] - FilterBar.tsx가
//   이미 쓰고 있는 것과 동일한 계산(224=448/2). 448이 바뀌면 이 값도 같이 바꿔야 한다.
// - 모바일: FilterBar.tsx가 top-14를 이미 차지하고 있고, "더보기"를 누르면 그 줄이 화면 거의
//   끝까지(92vw) 넓어져서 같은 줄 모서리에 두면 겹칠 수 있다. 그래서 그 위쪽 여백(top-2, 우상단)에
//   작은 배지로 띄운다 - FilterBar가 접혀있든 펼쳐있든 절대 겹치지 않는 위치.
// - 2026-08-12 추가: div였던 걸 button으로 바꿔서 눌러 수동 새로고침이 가능하게 했다
//   (pointer-events-none을 없애야 클릭이 먹는다 - 지도 위 오버레이라 원래는 지도 드래그를
//   방해하지 않으려고 pointer-events-none을 줬었는데, 이제 이 위젯 자체는 클릭 대상이라 뺀다).
export default function WeatherWidget({ weather, onRefresh, isRefreshing }: WeatherWidgetProps) {
  if (!weather) return null; // 부가 기능 - 못 불러왔으면 그냥 조용히 안 보여준다.

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-label="날씨 새로고침"
      className={[
        // 2026-08-12 추가: 배경(bg-surface/95)이 지도/버튼들과 톤이 비슷해서 눈에 잘 안 띈다는
        // 피드백 - 다른 알약들(border-black/10)보다 확실히 튀는 색깔 테두리(border-primary)를
        // 둘러서 "여기 정보성 위젯이 있다"는 게 한눈에 들어오게 했다.
        "absolute z-20 flex items-center gap-1.5 rounded-full border-2 border-primary/60 bg-surface/95 px-3 py-1.5 text-xs font-medium text-ink shadow-soft backdrop-blur transition hover:bg-primary-light active:scale-95 disabled:opacity-60",
        "right-4 top-2",
        "md:left-[calc(50%+224px)] md:right-auto md:top-6 md:-translate-x-1/2",
      ].join(" ")}
    >
      <span className="text-sm">{isRefreshing ? "⏳" : weather.icon}</span>
      <span>{weather.tempC}°</span>
      <span className="text-ink-soft">{weather.condition}</span>
    </button>
  );
}
