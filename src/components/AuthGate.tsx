"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateNicknameCandidates } from "@/lib/nickname";

interface AuthGateProps {
  companyCode: string;
}

// 회사코드는 URL에 이미 있으니, 이 화면에서는 닉네임+PIN만 받는다.
// 같은 닉네임+PIN이면 로그인, 처음 보는 닉네임이면 그 자리에서 계정이 만들어진다 (가입/로그인 통합).
// 닉네임이 이미 다른 사람 걸로 쓰이고 있으면(PIN 불일치) 대체 닉네임을 제안해준다.
export default function AuthGate({ companyCode }: AuthGateProps) {
  const router = useRouter();
  const [nickname, setNickname] = useState(() => generateNicknameCandidates(1)[0]);
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  function reroll() {
    setNickname(generateNicknameCandidates(1)[0]);
    setSuggestion(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim() || pin.length !== 4) return;

    setStatus("loading");
    setError(null);
    setSuggestion(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, nickname: nickname.trim(), pin }),
      });
      const data = await res.json();

      if (res.status === 409 && data.status === "conflict") {
        setStatus("error");
        setError("이미 다른 분이 사용 중인 닉네임이에요. 아래 닉네임으로 바꿔서 시도해보세요.");
        setSuggestion(data.suggestion);
        return;
      }

      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "로그인에 실패했습니다.");
        return;
      }

      router.refresh();
    } catch {
      setStatus("error");
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-6">
      <div className="w-full max-w-sm rounded-xl2 bg-surface p-8 shadow-soft">
        <h1 className="text-2xl font-bold text-ink">밥시간</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          닉네임과 PIN 4자리를 입력해주세요. 처음 사용하는 닉네임이면 자동으로 계정이
          만들어지고, 기존 닉네임+PIN이면 로그인됩니다.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-soft">닉네임</label>
            <div className="flex gap-2">
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="닉네임을 입력하세요"
                className="min-w-0 flex-1 rounded-xl2 border border-black/10 px-4 py-3 text-ink outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={reroll}
                className="shrink-0 whitespace-nowrap rounded-xl2 border border-black/10 px-3 text-sm text-ink-soft transition hover:bg-surface-muted"
              >
                다시 추천
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-soft">PIN (숫자 4자리)</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              type="password"
              inputMode="numeric"
              maxLength={4}
              className="w-full rounded-xl2 border border-black/10 px-4 py-3 text-center text-lg tracking-[0.5em] text-ink outline-none focus:border-primary"
            />
          </div>

          {error && <p className="text-sm leading-relaxed text-primary-dark">{error}</p>}
          {suggestion && (
            <button
              type="button"
              onClick={() => {
                setNickname(suggestion);
                setSuggestion(null);
                setError(null);
              }}
              className="rounded-xl2 bg-primary-light px-4 py-2.5 text-left text-sm font-medium text-primary-dark transition hover:bg-primary-light/70"
            >
              &ldquo;{suggestion}&rdquo; 닉네임으로 사용하기
            </button>
          )}

          <button
            type="submit"
            disabled={status === "loading" || pin.length !== 4 || !nickname.trim()}
            className="mt-1 rounded-xl2 bg-primary px-4 py-3 font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
          >
            {status === "loading" ? "확인 중..." : "시작하기"}
          </button>
        </form>
      </div>
    </main>
  );
}
