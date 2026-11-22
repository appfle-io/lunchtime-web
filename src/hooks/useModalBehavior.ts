"use client";

import { useEffect, useRef } from "react";

// 모든 모달이 공통으로 가져야 할 동작: Esc로 닫기, 닫힌 뒤 원래 버튼으로 포커스 되돌리기.
// 모달이 겹쳐 열릴 수 있으므로(상세 -> 정보수정 요청 등) 열린 순서대로 스택에 쌓고,
// Esc는 맨 위 모달 하나만 닫는다.
type Entry = { onClose: () => void };

const stack: Entry[] = [];

function handleKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.onClose();
}

export function useModalBehavior(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const entry: Entry = { onClose: () => onCloseRef.current() };
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (stack.length === 0) document.addEventListener("keydown", handleKeyDown);
    stack.push(entry);

    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
}
