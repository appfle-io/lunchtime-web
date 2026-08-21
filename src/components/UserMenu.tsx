"use client";

import { useEffect, useRef, useState } from "react";

interface UserMenuProps {
  nickname: string;
  onLogout: () => void;
  onChangePassword: () => void;
  onChangeNickname?: () => void;
  // 2026-08-09 신규: 관리자(isAdmin)에게만 "관리자 페이지" 항목을 보여주기 위한 값/핸들러.
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
}

// 2026-08-06 3차 신규: 예전엔 "{닉네임}님 · 로그아웃" 버튼 하나가 지도 좌상단에 절대좌표로
// 떠 있었는데(md:left-[28rem] 같은 매직넘버), "주변식당(BottomSheet) 있는 자리의 오른쪽 끝"으로
// 옮겨달라는 요청을 받음 - 새 절대좌표를 또 만드는 대신 BottomSheet의 title 줄(titleRight 슬롯)에
// 얹는다(RestaurantList -> BottomSheet). 이 컴포넌트는 그 슬롯 안에서만 동작하는 작은 드롭다운
// (로그아웃/비밀번호 변경/닉네임 변경)이라 독립된 좌표를 새로 잡을 필요가 없고, 레이아웃 회귀 위험도 없다.
// 2026-08-09 추가: isAdmin이면 "관리자 페이지" 항목을 맨 위에 하나 더 보여준다.
export default function UserMenu({
  nickname,
  onLogout,
  onChangePassword,
  onChangeNickname,
  isAdmin,
  onOpenAdmin,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:text-primary-dark"
      >
        {nickname}님 ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-xl border border-black/10 bg-surface shadow-soft">
          {isAdmin && (
            <button
              onClick={() => {
                setOpen(false);
                onOpenAdmin?.();
              }}
              className="block w-full px-3 py-2 text-left text-xs font-medium text-primary-dark transition hover:bg-surface-muted"
            >
              🛠️ 관리자 페이지
            </button>
          )}
          {onChangeNickname && (
            <button
              onClick={() => {
                setOpen(false);
                onChangeNickname();
              }}
              className="block w-full px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-muted"
            >
              닉네임 변경
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
            className="block w-full px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-muted"
          >
            비밀번호 변경
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="block w-full px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-muted"
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
