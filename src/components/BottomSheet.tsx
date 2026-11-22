"use client";

import { ReactNode, useState } from "react";
import Icon from "./ui/Icon";

interface BottomSheetProps {
  children: ReactNode;
  // 문자열이면 기본 제목(h2)으로, 노드면 그대로 그린다 (모바일에서 제목 자리에 탭을 두는 경우).
  title?: ReactNode;
  // 제목 줄 오른쪽 끝 슬롯 (사용자 메뉴).
  titleRight?: ReactNode;
  // 제목 아래, 스크롤 영역 밖에 고정되는 슬롯 (검색/같이 정하기 등 항상 보여야 하는 버튼).
  header?: ReactNode;
}

// 모바일: 화면 아래 바텀시트(접힘/펼침 2단). 데스크톱: 왼쪽 플로팅 카드.
// 바깥은 overflow-hidden, 안쪽 children 영역만 스크롤된다.
// 접힘 높이는 "지도를 너무 가리지 않으면서 목록이 최소 한 줄은 보이는" 값으로 맞춘다
// (헤더를 한 줄로 줄인 2.1.0 기준 약 33dvh에서 목록 1줄 이상).
// TODO: 끌어올리기 제스처, 3단(접힘/반/전체) 스냅.
export default function BottomSheet({ children, title, titleRight, header }: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className={[
        "absolute z-20 flex flex-col overflow-hidden rounded-t-2xl bg-surface shadow-soft transition-all",
        "bottom-0 left-0 right-0",
        expanded ? "h-[80dvh]" : "h-[33dvh]",
        // 데스크톱: CompanyHome의 왼쪽 컬럼 안에서 남는 세로 공간을 차지한다 (min-h-0은 가상 스크롤 높이 계산용).
        "md:static md:h-auto md:w-full md:flex-1 md:min-h-0 md:rounded-xl2",
      ].join(" ")}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mx-auto mt-1 flex h-5 w-12 shrink-0 items-center justify-center rounded-full text-ink-soft/70 transition hover:text-ink md:hidden"
        aria-label={expanded ? "목록 접기" : "목록 펼치기"}
        aria-expanded={expanded}
      >
        <Icon name={expanded ? "chevronDown" : "chevronUp"} className="h-4 w-4" />
      </button>
      {(title || titleRight) && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 md:px-5 md:pt-5">
          {typeof title === "string" ? <h2 className="text-lg font-bold text-ink">{title}</h2> : title}
          {titleRight}
        </div>
      )}
      {header && <div className="shrink-0 px-4 pt-2.5 md:px-5 md:pt-3">{header}</div>}
      <div className="flex-1 overflow-y-auto px-4 pb-3 pt-1 md:px-5 md:pb-5">{children}</div>
    </section>
  );
}
