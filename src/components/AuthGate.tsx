"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateNicknameCandidates } from "@/lib/nickname";
import { SECURITY_QUESTIONS, CUSTOM_QUESTION_OPTION } from "@/lib/security-questions";
import PinResetModal from "./PinResetModal";
import LoadingOverlay from "./LoadingOverlay";

interface AuthGateProps {
  companyCode: string;
}

const REMEMBER_KEY_PREFIX = "lt_remember_nickname_";

// 회사코드는 URL에 이미 있으니, 이 화면에서는 닉네임+PIN만 받는다.
// 같은 닉네임+PIN이면 로그인, 처음 보는 닉네임이면 그 자리에서 계정이 만들어진다 (가입/로그인 통합).
// 닉네임이 이미 다른 사람 걸로 쓰이고 있으면(PIN 불일치) 대체 닉네임을 제안해준다.
//
// 2026-08-06 3차 신규:
// - "ID 저장" 체크박스(기본 체크) - 체크한 상태로 로그인/가입에 성공하면 닉네임을 브라우저에
//   저장해서 다음에 들어올 때 미리 채워준다. 체크를 해제하면 저장된 값을 지운다.
// - 가입(처음 보는 닉네임으로 계정이 막 만들어진 경우)에 성공하면 곧바로 앱으로 들어가지 않고,
//   비밀번호 찾기용 질문/답변을 등록하는 화면을 한 번 보여준다("나중에 하기"로 건너뛸 수 있음).
// - "비밀번호를 잊으셨나요?" 링크로 PinResetModal(forgot 모드)을 띄운다.
export default function AuthGate({ companyCode }: AuthGateProps) {
  const router = useRouter();
  const [nickname, setNickname] = useState(() => generateNicknameCandidates(1)[0]);
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [step, setStep] = useState<"login" | "setup-question">("login");
  const [showForgot, setShowForgot] = useState(false);
  // 2026-08-10 신규: 로그인/가입 성공 후 router.refresh()가 CompanyHome을 다시 그리는 동안(닉네임+PIN
  // 확인은 이미 끝났는데 정작 화면은 restaurants/favorites 등을 다시 불러올 때까지 안 넘어가서
  // "버튼 눌러도 반응 없다가 화면이 넘어가는" 것처럼 보이던 구간) 로딩 오버레이를 보여준다.
  const [isPending, startTransition] = useTransition();

  // 저장된 닉네임이 있으면 불러온다. SSR과의 초기 렌더 불일치를 피하려고 useState 초기값이 아니라
  // 마운트 후 effect에서 채운다.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`${REMEMBER_KEY_PREFIX}${companyCode}`);
      if (saved) setNickname(saved);
    } catch {
      // localStorage 접근 실패(프라이버시 모드 등)는 조용히 무시 - 기능 없이도 로그인은 가능해야 한다.
    }
  }, [companyCode]);

  // 보안 질문 등록 폼(가입 직후) 상태
  const [secChoice, setSecChoice] = useState(SECURITY_QUESTIONS[0]);
  const [secCustomQuestion, setSecCustomQuestion] = useState("");
  const [secAnswer, setSecAnswer] = useState("");
  const [secSubmitting, setSecSubmitting] = useState(false);

  function reroll() {
    setNickname(generateNicknameCandidates(1)[0]);
    setSuggestion(null);
    setError(null);
  }

  function rememberNicknameIfNeeded(finalNickname: string) {
    try {
      if (remember) {
        window.localStorage.setItem(`${REMEMBER_KEY_PREFIX}${companyCode}`, finalNickname);
      } else {
        window.localStorage.removeItem(`${REMEMBER_KEY_PREFIX}${companyCode}`);
      }
    } catch {
      // 위와 동일한 이유로 무시.
    }
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

      rememberNicknameIfNeeded(nickname.trim());

      if (data.status === "signup") {
        setStatus("idle");
        setStep("setup-question");
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    } catch {
      setStatus("error");
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    }
  }

  async function handleSecuritySubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalQuestion =
      secChoice === CUSTOM_QUESTION_OPTION ? secCustomQuestion.trim() : secChoice;
    if (!finalQuestion || !secAnswer.trim()) return;

    setSecSubmitting(true);
    try {
      await fetch("/api/auth/security-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, question: finalQuestion, answer: secAnswer.trim() }),
      });
    } catch {
      // 가입 자체는 이미 끝났으니 실패해도 그냥 진행 - 나중에 "비밀번호 변경"에서 다시 등록할 수 있다.
    } finally {
      setSecSubmitting(false);
      startTransition(() => {
        router.refresh();
      });
    }
  }

  if (step === "setup-question") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-6">
        <div className="w-full max-w-sm rounded-xl2 bg-surface p-8 shadow-soft">
          <h1 className="text-2xl font-bold text-ink">거의 다 됐어요!</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            나중에 PIN을 잊어버렸을 때 되찾을 수 있도록, 질문과 답변을 하나 등록해두세요.
          </p>

          <form onSubmit={handleSecuritySubmit} className="mt-6 flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">질문 선택</label>
              <select
                value={secChoice}
                onChange={(e) => setSecChoice(e.target.value)}
                className="w-full rounded-xl2 border border-black/10 px-4 py-3 text-ink outline-none focus:border-primary"
              >
                {SECURITY_QUESTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
                <option value={CUSTOM_QUESTION_OPTION}>{CUSTOM_QUESTION_OPTION}</option>
              </select>
            </div>

            {secChoice === CUSTOM_QUESTION_OPTION && (
              <input
                value={secCustomQuestion}
                onChange={(e) => setSecCustomQuestion(e.target.value)}
                placeholder="질문을 직접 입력하세요"
                className="rounded-xl2 border border-black/10 px-4 py-3 text-ink outline-none focus:border-primary"
              />
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">답변</label>
              <input
                value={secAnswer}
                onChange={(e) => setSecAnswer(e.target.value)}
                placeholder="답변을 입력하세요"
                className="w-full rounded-xl2 border border-black/10 px-4 py-3 text-ink outline-none focus:border-primary"
              />
            </div>

            <button
              type="submit"
              disabled={secSubmitting}
              className="mt-1 rounded-xl2 bg-primary px-4 py-3 font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {secSubmitting ? "등록하는 중..." : "등록하고 시작하기"}
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => router.refresh())}
              className="text-center text-xs text-ink-soft underline-offset-2 hover:text-primary-dark hover:underline"
            >
              나중에 설정할게요
            </button>
          </form>
        </div>
        {isPending && <LoadingOverlay message="불러오는 중..." />}
      </main>
    );
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

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-black/20"
              />
              아이디(닉네임) 저장
            </label>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-xs text-ink-soft underline-offset-2 hover:text-primary-dark hover:underline"
            >
              비밀번호를 잊으셨나요?
            </button>
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
            disabled={status === "loading" || isPending || pin.length !== 4 || !nickname.trim()}
            className="mt-1 rounded-xl2 bg-primary px-4 py-3 font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
          >
            {status === "loading" || isPending ? "확인 중..." : "시작하기"}
          </button>
        </form>
      </div>

      <PinResetModal
        companyCode={companyCode}
        open={showForgot}
        mode="forgot"
        onClose={() => setShowForgot(false)}
        onSuccess={() => setShowForgot(false)}
      />
      {isPending && <LoadingOverlay message="불러오는 중..." />}
    </main>
  );
}
