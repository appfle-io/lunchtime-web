"use client";

import { useEffect, useState } from "react";

interface NicknameChangeModalProps {
  open: boolean;
  currentNickname: string;
  onClose: () => void;
  onSuccess: (newNickname: string) => void;
  onNotify?: (message: string) => void;
}

export default function NicknameChangeModal({
  open,
  currentNickname,
  onClose,
  onSuccess,
  onNotify,
}: NicknameChangeModalProps) {
  const [newNickname, setNewNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewNickname("");
    setError(null);
    setLoading(false);
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newNickname.trim();
    if (!trimmed) {
      setError("새 닉네임을 입력해주세요.");
      return;
    }
    if (trimmed === currentNickname.trim()) {
      setError("현재 닉네임과 동일합니다.");
      return;
    }
    if (trimmed.length > 20) {
      setError("닉네임은 20자 이하로 입력해주세요.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/nickname/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newNickname: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "닉네임을 변경하지 못했어요.");
        setLoading(false);
        return;
      }

      onSuccess(data.nickname);
      onNotify?.(`닉네임이 "${data.nickname}"(으)로 변경되었어요! 🎉`);
      onClose();
    } catch {
      setError("네트워크 오류로 닉네임을 변경하지 못했어요. 다시 시도해주세요.");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">닉네임 변경</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-xs text-ink-soft">
          현재 닉네임: <span className="font-semibold text-ink">{currentNickname}</span>
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft">새 닉네임</label>
            <input
              type="text"
              value={newNickname}
              onChange={(e) => {
                setNewNickname(e.target.value);
                if (error) setError(null);
              }}
              placeholder="새 닉네임 입력 (최대 20자)"
              maxLength={20}
              autoFocus
              className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none transition focus:border-primary"
            />
          </div>

          <div className="rounded-xl bg-surface-muted p-2.5 text-[11px] text-ink-soft leading-relaxed">
            💡 닉네임을 변경하면 나를 친구로 등록한 동료들의 친구 목록 및 진행 중인 투표에서도 새 닉네임으로 자동 반영됩니다.
          </div>

          {error && <p className="text-xs text-primary-dark">{error}</p>}

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-xl bg-surface-muted px-3 py-2 text-xs font-medium text-ink transition hover:bg-black/5"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !newNickname.trim()}
              className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {loading ? "변경 중..." : "변경하기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
