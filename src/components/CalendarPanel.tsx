"use client";

import { ReactNode } from "react";

interface CalendarPanelProps {
  children: ReactNode;
}

// 2026-08-06 심야 신규: "주변 식당 카드 바로 아래 빈 공간(파란 박스)에 캘린더를 새 카드로 노출해달라"는
// 요청에 대응하는 데스크톱 전용 카드.
// 2026-08-07 수정: 예전엔 top-[calc(40vh+2rem)]~bottom-4로 남는 세로 공간을 전부 이 카드가
// 강제로 채우게 해서, 캘린더 실제 내용(달력 그리드)보다 카드가 훨씬 커져 카드 안쪽에 큰 빈
// 여백이 생기는 문제가 있었다("왼쪽 캘린더 여백이 너무 심하다" 피드백). 이제 이 카드는
// CompanyHome의 좌측 패널 wrapper(md:flex md:flex-col) 안에서 shrink-0(내용 높이만큼만 차지)로
// 동작하고, 위에 있는 주변식당 카드(BottomSheet, flex-1)가 그만큼 커진 나머지 공간을 흡수한다.
// 모바일에서는 이 카드를 아예 그리지 않는다(hidden) - 화면이 좁아서 카드를 하나 더 띄울 공간이 없다는
// 피드백에 따라, 모바일은 대신 RestaurantList의 바텀시트 안에 "주변식당/캘린더" 탭으로 전환해서 보여준다
// (RestaurantList.tsx 참고). 그래서 이 컴포넌트를 실제로 마운트할지는 CompanyHome.tsx가
// matchMedia(min-width: 768px)로 판단해서, 데스크톱일 때만 MealLogCalendar를 이 안에 넣어준다 -
// 모바일 탭 쪽과 이 카드에 동시에 MealLogCalendar를 마운트하면 같은 데이터를 두 번 fetch하게 되므로
// 한쪽만 마운트되게 한다.
export default function CalendarPanel({ children }: CalendarPanelProps) {
  return (
    <section
      className={[
        "z-20 hidden flex-col overflow-hidden rounded-xl2 bg-surface shadow-soft",
        "md:flex md:static md:w-full md:shrink-0",
      ].join(" ")}
    >
      <div className="shrink-0 px-5 pt-4">
        <h2 className="text-base font-bold text-ink">밥 먹은 기록</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">{children}</div>
    </section>
  );
}
