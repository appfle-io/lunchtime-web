"use client";

import { useEffect } from "react";

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

// 화면 상단에 잠깐 떠 있다가 자동으로 사라지는 알림. fixed로 띄워서 지도/바텀시트 위에 항상 보이게 한다.
export default function Toast({ message, onDismiss, durationMs = 2600 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div className="pointer-events-auto max-w-[90%] rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-white shadow-soft">
        {message}
      </div>
    </div>
  );
}
