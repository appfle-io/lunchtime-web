"use client";

import { ReactNode, useEffect, useState } from "react";
import Icon from "./ui/Icon";

interface CalendarPanelProps {
  children: ReactNode;
}

const STORAGE_KEY = "lt:calendarPanelOpen";

// 데스크톱 전용 "밥 먹은 기록" 카드 (모바일은 RestaurantList의 캘린더 탭).
// 펼쳐 두면 캘린더가 주변 식당 목록보다 커져서(1440x900에서 목록 1.5줄) 기본은 접어 두고,
// 사용자가 펼친 상태는 기억한다. 접혀 있어도 내용은 마운트된 채라 다시 불러오지 않는다.
export default function CalendarPanel({ children }: CalendarPanelProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <section
      className={[
        "z-20 hidden flex-col overflow-hidden rounded-xl2 bg-surface shadow-soft",
        "md:flex md:static md:w-full md:shrink-0",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex shrink-0 items-center justify-between px-5 py-3.5 text-left transition hover:bg-surface-muted/60"
      >
        <span className="flex items-center gap-2 text-base font-bold text-ink">
          <Icon name="calendar" className="h-4 w-4 text-ink-soft" />
          밥 먹은 기록
        </span>
        <Icon name={open ? "chevronUp" : "chevronDown"} className="h-4 w-4 text-ink-soft" />
      </button>
      <div className={open ? "flex-1 overflow-y-auto px-5 pb-4" : "hidden"}>{children}</div>
    </section>
  );
}
