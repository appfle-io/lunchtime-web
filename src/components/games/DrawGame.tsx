"use client";

import { useEffect, useState } from "react";
import type { MiniGameParticipant } from "@/types";

interface DrawGameProps {
  participants: MiniGameParticipant[];
  winnerCount: number;
  onFinish: (winners: MiniGameParticipant[]) => void;
}

// Fisher-Yates 셔플
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type CardState = "hidden" | "win" | "lose";

const SHUFFLE_DURATION_MS = 550;

// 제비뽑기: 참가자 수만큼 제비 칸을 만들고, 그중 당첨자 수만큼만 미리 무작위로 "당첨"을
// 배정해둔다(칸 위치는 섞어서 아무도 어느 칸이 당첨인지 미리 알 수 없다). 카드 하나는 항상 같은
// 참가자에게 고정 배정되고(칸 아래 이름 표시), 그 사람이 원할 때 자기 카드를 클릭하면 된다.
//
// 2026-08-12 3차 수정: "다음 사람에게 넘겨주세요"/"다음: OOO님 차례" 처럼 한 명씩 순서대로
// 폰을 넘겨받아 진행하는 방식은 인원이 많아질수록 클릭 수가 계속 늘어나서 번거롭다는 피드백을
// 받았다 - 한 화면을 다 같이 보면서 각자 자기 카드를 원하는 순서로 클릭하면 되는 방식으로
// 바꿨다. 순서를 강제하지 않으므로 "차례" 개념 자체가 없어졌고, 모든 카드가 뽑히면 확인 버튼
// 없이 바로 결과 화면으로 넘어간다.
//
// 2026-08-12 5차 수정: 아무도 아직 안 뽑은 상태에서 "다시 섞기"를 여러 번 눌러서 당첨 배정을
// 다시 무작위로 뽑아볼 수 있게 했다(원할 때 확정하고 실제로 뽑기 시작하면 됨). 한 명이라도 이미
// 뽑았으면 결과가 꼬이지 않도록 다시 섞기는 막는다.
export default function DrawGame({ participants, winnerCount, onFinish }: DrawGameProps) {
  const [winnerSlots, setWinnerSlots] = useState<boolean[]>(() =>
    shuffle(participants.map((_, i) => i < winnerCount))
  );
  const [cardStates, setCardStates] = useState<CardState[]>(() =>
    participants.map(() => "hidden" as CardState)
  );
  const [winners, setWinners] = useState<MiniGameParticipant[]>([]);
  const [shuffling, setShuffling] = useState(false);

  const hasStarted = cardStates.some((s) => s !== "hidden");

  // 카드가 전부(=참가자 전원) 뽑히면 별도 확인 버튼 없이 바로 결과 화면으로 넘어간다.
  useEffect(() => {
    if (participants.length > 0 && cardStates.every((s) => s !== "hidden")) {
      onFinish(winners);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardStates]);

  function pickCard(cardIndex: number) {
    if (shuffling || cardStates[cardIndex] !== "hidden") return;
    const isWinner = winnerSlots[cardIndex];
    setCardStates((prev) => prev.map((s, i) => (i === cardIndex ? (isWinner ? "win" : "lose") : s)));
    if (isWinner) setWinners((prev) => [...prev, participants[cardIndex]]);
  }

  // "다시 섞기" - 아직 아무도 안 뽑았을 때만 당첨 배정을 새로 무작위로 뽑아서 원하는 만큼
  // 반복할 수 있게 한다.
  function handleReshuffle() {
    if (shuffling || hasStarted) return;
    setShuffling(true);
    setTimeout(() => {
      setWinnerSlots(shuffle(participants.map((_, i) => i < winnerCount)));
      setShuffling(false);
    }, SHUFFLE_DURATION_MS);
  }

  // "결과 바로 보기" - 아직 안 뽑힌 카드를 전부 한 번에 확정해서 결과 화면으로 넘어간다.
  function handleRevealAll() {
    const finalWinners = [...winners];
    cardStates.forEach((state, i) => {
      if (state === "hidden" && winnerSlots[i]) finalWinners.push(participants[i]);
    });
    onFinish(finalWinners);
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {shuffling ? "제비를 섞는 중..." : "각자 자기 카드를 클릭해서 확인하세요"}
        </p>
        <div className="flex shrink-0 gap-2.5">
          {!hasStarted && (
            <button
              onClick={handleReshuffle}
              disabled={shuffling}
              className="text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline disabled:opacity-40"
            >
              다시 섞기
            </button>
          )}
          <button
            onClick={handleRevealAll}
            disabled={shuffling}
            className="text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline disabled:opacity-40"
          >
            결과 바로 보기
          </button>
        </div>
      </div>

      {shuffling && (
        <div className="flex items-center justify-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-ink [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-ink [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-ink" />
        </div>
      )}

      <div
        className={[
          "grid w-full grid-cols-3 gap-2 transition-opacity",
          shuffling ? "pointer-events-none opacity-40" : "",
        ].join(" ")}
      >
        {participants.map((p, cardIndex) => (
          <button
            key={cardIndex}
            onClick={() => pickCard(cardIndex)}
            disabled={shuffling || cardStates[cardIndex] !== "hidden"}
            title={p.name}
            className={[
              "flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl2 border px-1 text-sm font-semibold transition",
              cardStates[cardIndex] === "hidden"
                ? "border-black/10 bg-surface text-ink hover:border-primary"
                : cardStates[cardIndex] === "win"
                  ? "border-primary bg-primary-light text-primary-dark"
                  : "border-black/10 bg-surface-muted text-ink-soft",
            ].join(" ")}
          >
            <span className="max-w-full truncate text-xs font-medium">{p.name}</span>
            <span>{cardStates[cardIndex] === "hidden" ? "" : cardStates[cardIndex] === "win" ? "당첨!" : "꽝"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
