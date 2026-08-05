"use client";

import { ReactNode, useState } from "react";

interface BottomSheetProps {
  children: ReactNode;
  title?: string;
}

// 모바일에서는 화면 하단에서 끌어올리는 바텀시트, 데스크톱에서는 좌상단 플로팅 카드로 보이는
// 공용 셸 컴포넌트. "좌측 고정 패널 + 우측 지도"라는 전형적인 지도앱 틀을 벗어나기 위한 장치.
// TODO: 실제 드래그 제스처(Framer Motion)로 높이 조절, snap point(접힘/반펼침/완전펼침) 추가.
export default function BottomSheet({ children, title }: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className={[
        "absolute z-20 rounded-t-xl2 bg-surface shadow-soft transition-all",
        // 모바일: 하단 고정
        "bottom-0 left-0 right-0",
        expanded ? "h-[70vh]" : "h-[32vh]",
        // 데스크톱: 좌상단 플로팅 카드
        "md:left-6 md:right-auto md:top-6 md:bottom-6 md:w-[360px] md:rounded-xl2",
      ].join(" ")}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mx-auto mt-3 block h-1.5 w-10 rounded-full bg-black/10 md:hidden"
        aria-label="펼치기/접기"
      />
      {title && <h2 className="px-5 pt-3 text-lg font-bold text-ink md:pt-5">{title}</h2>}
      <div className="h-full overflow-y-auto px-5 pb-6 pt-2">{children}</div>
    </section>
  );
}
