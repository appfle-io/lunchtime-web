"use client";

import { ReactNode } from "react";

interface CalendarPanelProps {
  children: ReactNode;
}

// 2026-08-06 심야 신규: "주변 식당 카드 바로 아래 빈 공간(파란 박스)에 캘린더를 새 카드로 노출해달라"는
// 요청에 대응하는 데스크톱 전용 카드. BottomSheet(주변식당 카드)는 md:top-4 md:bottom-4로 선언돼
// 있지만 실제 높이는 항상 h-[40vh]로 고정돼 있다(모바일 확장/접힘 버튼이 md:hidden이라 데스크톱에선
// expanded가 절대 true가 안 되기 때문) - 그래서 top-4(1rem) + 40vh 만큼만 차지하고 bottom-4까지
// 남는 여백이 지도로 그대로 드러나 있었다. 이 카드가 그 여백(1rem 간격을 두고 시작해 bottom-4까지)을
// 채운다.
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
        "absolute z-20 hidden flex-col overflow-hidden rounded-xl2 bg-surface shadow-soft",
        "md:left-6 md:flex md:w-[400px] md:top-[calc(40vh+2rem)] md:bottom-4",
      ].join(" ")}
    >
      <div className="shrink-0 px-5 pt-4">
        <h2 className="text-base font-bold text-ink">📅 밥 먹은 기록</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">{children}</div>
    </section>
  );
}
