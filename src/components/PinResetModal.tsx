"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SECURITY_QUESTIONS, CUSTOM_QUESTION_OPTION } from "@/lib/security-questions";

interface PinResetModalProps {
  companyCode: string;
  open: boolean;
  onClose: () => void;
  // "forgot": 로그인 화면의 "비밀번호를 잊으셨나요?" - 닉네임을 직접 입력해야 한다(세션이 없음).
  // "change": 로그인된 상태의 "비밀번호 변경" - 닉네임은 이미 알고 있으니(fixedNickname) 안 받는다.
  mode: "forgot" | "change";
  fixedNickname?: string;
  onNotify?: (message: string) => void;
  onSuccess?: () => void;
}

type Step = "nickname" | "setup-question" | "question" | "newpin" | "done";

// 2026-08-06 3차 신규: 비밀번호(PIN) 찾기/변경 공용 모달. 두 플로우가 "질문 확인 -> 답변 검증
// -> 새 PIN 입력"이라는 같은 단계를 거치기 때문에 하나로 합쳤다.
// - forgot: 질문이 없는 계정이면(이 기능 도입 이전 가입) 본인 확인 수단이 없어 여기서 등록해줄
//   수 없다 - PIN을 몰라서 온 사람이라 어떤 답도 신뢰할 수 없기 때문. 안내만 하고 중단한다.
// - change: 로그인된 상태이므로, 질문이 아직 없으면 그 자리에서 새로 등록하고 곧바로 검증 단계로
//   넘어간다(사용자 요청: "비밀번호 변경은 문답 검증 한번 하고 진행할 수 있게").
export default function PinResetModal({
  companyCode,
  open,
  onClose,
  mode,
  fixedNickname,
  onNotify,
  onSuccess,
}: PinResetModalProps) {
  const router = useRouter();
  const [nickname, setNickname] = useState(fixedNickname ?? "");
  const [step, setStep] = useState<Step>(mode === "change" ? "question" : "nickname");
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 계정에 아직 질문이 없을 때(이 기능 도입 이전 가입) 새로 등록하는 폼 - change 모드에서만 의미가 있다.
  const [setupChoice, setSetupChoice] = useState(SECURITY_QUESTIONS[0]);
  const [setupCustomQuestion, setSetupCustomQuestion] = useState("");
  const [setupAnswer, setSetupAnswer] = useState("");

  useEffect(() => {
    if (!open) return;
    setNickname(fixedNickname ?? "");
    setStep(mode === "change" ? "question" : "nickname");
    setQuestion(null);
    setAnswer("");
    setVerifyToken(null);
    setNewPin("");
    setError(null);
    if (mode === "change" && fixedNickname) {
      fetchQuestion(fixedNickname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, fixedNickname]);

  if (!open) return null;

  async function fetchQuestion(nick: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/auth/security-question?companyCode=${encodeURIComponent(companyCode)}&nickname=${encodeURIComponent(nick)}`
      );
      if (!res.ok) {
        // 질문이 등록 안 된 계정 - change 모드면 등록 폼으로, forgot 모드면 안내만 하고 막다른 길로.
        setStep("setup-question");
        return;
      }
      const data = await res.json();
      setQuestion(data.question);
      setStep("question");
    } catch {
      setError("네트워크 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleNicknameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) return;
    await fetchQuestion(nickname.trim());
  }

  async function handleSetupQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "forgot") return; // 이 분기에서는 폼 자체가 없고 안내 텍스트만 보인다.

    const finalQuestion =
      setupChoice === CUSTOM_QUESTION_OPTION ? setupCustomQuestion.trim() : setupChoice;
    if (!finalQuestion || !setupAnswer.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/security-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, question: finalQuestion, answer: setupAnswer.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "질문 등록에 실패했어요.");
        return;
      }
      onNotify?.("비밀번호 찾기용 질문을 등록했어요. 이어서 PIN을 변경해줘.");
      setQuestion(finalQuestion);
      setAnswer(setupAnswer.trim());
      setStep("question");
    } catch {
      setError("네트워크 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAnswerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, nickname, answer: answer.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "답변이 일치하지 않아요.");
        return;
      }
      setVerifyToken(data.verifyToken);
      setStep("newpin");
    } catch {
      setError("네트워크 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPin.length !== 4 || !verifyToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, nickname, verifyToken, newPin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "PIN 변경에 실패했어요.");
        return;
      }
      setStep("done");
      onNotify?.("PIN이 변경됐어요.");
      if (mode === "forgot") router.refresh();
      onSuccess?.();
    } catch {
      setError("네트워크 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {mode === "forgot" ? "비밀번호 찾기" : "비밀번호(PIN) 변경"}
          </h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        {step === "nickname" && (
          <form onSubmit={handleNicknameSubmit} className="flex flex-col gap-2">
            <label className="text-xs font-medium text-ink-soft">닉네임</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임을 입력하세요"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              autoFocus
            />
            {error && <p className="text-xs text-primary-dark">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {loading ? "확인 중..." : "다음"}
            </button>
          </form>
        )}

        {step === "setup-question" && mode === "forgot" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-ink-soft">
              이 계정은 비밀번호 찾기용 질문이 설정되어 있지 않아요. PIN을 기억하고 있다면 로그인
              후 우측 상단 닉네임 메뉴의 &ldquo;비밀번호 변경&rdquo;에서 새로 설정할 수 있어요.
            </p>
            <button
              type="button"
              onClick={() => setStep("nickname")}
              className="rounded-xl px-3 py-2 text-sm text-ink-soft transition hover:bg-surface-muted"
            >
              다른 닉네임으로 다시 시도
            </button>
          </div>
        )}

        {step === "setup-question" && mode === "change" && (
          <form onSubmit={handleSetupQuestion} className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed text-ink-soft">
              아직 비밀번호 찾기용 질문이 설정되어 있지 않아요. 먼저 질문/답변을 등록하면 곧바로
              PIN 변경으로 넘어가요.
            </p>
            <label className="text-xs font-medium text-ink-soft">질문 선택</label>
            <select
              value={setupChoice}
              onChange={(e) => setSetupChoice(e.target.value)}
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {SECURITY_QUESTIONS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
              <option value={CUSTOM_QUESTION_OPTION}>{CUSTOM_QUESTION_OPTION}</option>
            </select>
            {setupChoice === CUSTOM_QUESTION_OPTION && (
              <input
                value={setupCustomQuestion}
                onChange={(e) => setSetupCustomQuestion(e.target.value)}
                placeholder="질문을 직접 입력하세요"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            )}
            <label className="text-xs font-medium text-ink-soft">답변</label>
            <input
              value={setupAnswer}
              onChange={(e) => setSetupAnswer(e.target.value)}
              placeholder="답변을 입력하세요"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {error && <p className="text-xs text-primary-dark">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {loading ? "등록하는 중..." : "등록하고 계속하기"}
            </button>
          </form>
        )}

        {step === "question" && (
          <form onSubmit={handleAnswerSubmit} className="flex flex-col gap-2">
            <p className="text-sm text-ink">{question}</p>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="답변 입력"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              autoFocus
            />
            {error && <p className="text-xs text-primary-dark">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {loading ? "확인 중..." : "확인"}
            </button>
          </form>
        )}

        {step === "newpin" && (
          <form onSubmit={handleNewPinSubmit} className="flex flex-col gap-2">
            <label className="text-xs font-medium text-ink-soft">새 PIN (숫자 4자리)</label>
            <input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              type="password"
              inputMode="numeric"
              maxLength={4}
              className="rounded-xl border border-black/10 px-3 py-2 text-center text-lg tracking-[0.5em] outline-none focus:border-primary"
              autoFocus
            />
            {error && <p className="text-xs text-primary-dark">{error}</p>}
            <button
              type="submit"
              disabled={loading || newPin.length !== 4}
              className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
            >
              {loading ? "변경하는 중..." : "PIN 변경하기"}
            </button>
          </form>
        )}

        {step === "done" && <p className="text-sm text-ink">✅ PIN이 변경됐어요.</p>}
      </div>
    </div>
  );
}
