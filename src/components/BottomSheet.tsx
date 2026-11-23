"use client";

import { ReactNode, useRef, useState, type CSSProperties, type PointerEvent } from "react";

interface BottomSheetProps {
  children: ReactNode;
  // 문자열이면 기본 제목(h2)으로, 노드면 그대로 그린다 (모바일에서 제목 자리에 탭을 두는 경우).
  title?: ReactNode;
  // 제목 줄 오른쪽 끝 슬롯 (사용자 메뉴).
  titleRight?: ReactNode;
  // 제목 아래, 스크롤 영역 밖에 고정되는 슬롯 (검색/같이 정하기 등 항상 보여야 하는 버튼).
  header?: ReactNode;
}

// 모바일 바텀시트 높이 단계 (dvh). 접힘은 "지도를 너무 가리지 않으면서 목록이 최소 한 줄은 보이는" 값
// (헤더를 한 줄로 줄인 2.1.0 기준 33dvh에서 목록 1줄 이상), 반은 지도와 목록을 같이 보는 높이, 전체는 목록 위주.
const SNAPS_DVH = [33, 55, 85] as const; // 전체를 85로: 88이면 지도 위 필터 칩과 겹친다
const SNAP_LABELS = ["접힘", "반", "전체"];
// 이 거리(px) 안에서 손을 떼면 끌기가 아니라 누르기로 본다.
const TAP_SLOP_PX = 6;
// 이 속도(px/ms)보다 빠르게 튕기면 가까운 단계 대신 튕긴 방향의 다음 단계로 간다.
const FLICK_VELOCITY = 0.5;

// 모바일: 화면 아래 바텀시트. 손잡이를 위아래로 끌거나 튕겨서 접힘/반/전체 3단으로 맞추고, 누르면 접힘 <-> 반.
// 데스크톱: 왼쪽 플로팅 카드 (높이 조절 없음).
// 바깥은 overflow-hidden, 안쪽 children 영역만 스크롤된다.
export default function BottomSheet({ children, title, titleRight, header }: BottomSheetProps) {
  const [snap, setSnap] = useState(0);
  // 끄는 중일 때의 높이(px). null이면 단계 높이를 쓴다.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startY: number; startHeight: number; lastY: number; lastTime: number; velocity: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const viewportHeight = () => window.visualViewport?.height ?? window.innerHeight;
  const snapPx = (i: number) => (SNAPS_DVH[i] / 100) * viewportHeight();

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const height = sectionRef.current?.getBoundingClientRect().height ?? snapPx(snap);
    drag.current = { startY: e.clientY, startHeight: height, lastY: e.clientY, lastTime: e.timeStamp, velocity: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < TAP_SLOP_PX) return;
    d.moved = true;
    const dt = Math.max(1, e.timeStamp - d.lastTime);
    d.velocity = (e.clientY - d.lastY) / dt; // 아래로 끌면 +
    d.lastY = e.clientY;
    d.lastTime = e.timeStamp;
    const min = snapPx(0) * 0.8;
    const max = snapPx(SNAPS_DVH.length - 1);
    setDragHeight(Math.min(max, Math.max(min, d.startHeight - dy)));
  }

  function onPointerEnd() {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return; // 누르기는 onClick에서 처리
    suppressClick.current = true;
    const current = dragHeight ?? d.startHeight;
    let next: number;
    if (d.velocity < -FLICK_VELOCITY) {
      next = SNAPS_DVH.findIndex((_, i) => snapPx(i) > current + 1);
      if (next === -1) next = SNAPS_DVH.length - 1;
    } else if (d.velocity > FLICK_VELOCITY) {
      next = 0;
      for (let i = SNAPS_DVH.length - 1; i >= 0; i--) {
        if (snapPx(i) < current - 1) {
          next = i;
          break;
        }
      }
    } else {
      next = 0;
      SNAPS_DVH.forEach((_, i) => {
        if (Math.abs(snapPx(i) - current) < Math.abs(snapPx(next) - current)) next = i;
      });
    }
    setSnap(next);
    setDragHeight(null);
  }

  function onClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSnap((s) => (s === 0 ? 1 : 0));
  }

  // 높이는 CSS 변수로 넘긴다. 데스크톱(md:h-auto)에서는 미디어 쿼리가 이기도록 인라인 height를 쓰지 않는다.
  const style = {
    "--sheet-h": dragHeight !== null ? `${dragHeight}px` : `${SNAPS_DVH[snap]}dvh`,
  } as CSSProperties;

  return (
    <section
      ref={sectionRef}
      style={style}
      className={[
        "absolute z-20 flex flex-col overflow-hidden rounded-t-2xl bg-surface shadow-soft",
        "bottom-0 left-0 right-0 h-[var(--sheet-h)]",
        dragHeight === null ? "motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out" : "",
        // 데스크톱: CompanyHome의 왼쪽 컬럼 안에서 남는 세로 공간을 차지한다 (min-h-0은 가상 스크롤 높이 계산용).
        "md:static md:h-auto md:w-full md:flex-1 md:min-h-0 md:rounded-xl2",
      ].join(" ")}
    >
      {/* 손잡이: 가로 전체가 끌기 영역 (예전엔 48x20px 버튼이라 누르기 어려웠다) */}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        className="flex h-6 w-full shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing md:hidden"
        aria-label={`목록 높이 조절 (지금: ${SNAP_LABELS[snap]}). 누르면 ${snap === 0 ? "펼치기" : "접기"}`}
        aria-expanded={snap > 0}
      >
        <span className="h-1 w-10 rounded-full bg-ink-soft/30" />
      </button>
      {(title || titleRight) && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 md:px-5 md:pt-5">
          {typeof title === "string" ? <h2 className="text-lg font-bold text-ink">{title}</h2> : title}
          {titleRight}
        </div>
      )}
      {header && <div className="shrink-0 px-4 pt-2.5 md:px-5 md:pt-3">{header}</div>}
      {/* 아이폰 하단 홈 막대 영역(safe-area)만큼 목록 끝에 여백을 둔다 */}
      <div className="flex-1 overflow-y-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 md:px-5 md:pb-5">
        {children}
      </div>
    </section>
  );
}
