"use client";

import { useState } from "react";
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

// 제비뽑기: 참가자 수만큼 제비 칸을 만들고, 그중 당첨자 수만큼만 미리 무작위로 "당첨"을
// 배정해둔다(칸 위치는 섞어서 아무도 어느 칸이 당첨인지 미리 알 수 없다).
//
// 2026-08-12 수정: 처음엔 카드를 뽑을 때마다 "폰을 다음 사람에게 넘겨주세요"라는 중간 화면을
// 거치게 했었는데(사다리타기와 동일한 패턴), 사용자 피드백으로 제비뽑기는 그 절차가 필요
// 없다고 판단해 없앴다 - 카드를 뽑으면 바로 그 자리에서 결과가 보이고, 버튼 한 번으로 곧장
// 다음 사람 차례로 넘어가서 이어서 뽑을 수 있다(화면 전환/별도 확인 단계 없음).
export default function DrawGame({ participants, winnerCount, onFinish }: DrawGameProps) {
  const [winnerSlots] = useState<boolean[]>(() =>
    shuffle(participants.map((_, i) => i < winnerCount))
  );
  const [cardStates, setCardStates] = useState<CardState[]>(() =>
    participants.map(() => "hidden" as CardState)
  );
  const [turnIndex, setTurnIndex] = useState(0);
  const [justPicked, setJustPicked] = useState<{ isWinner: boolean } | null>(null);
  const [winners, setWinners] = useState<MiniGameParticipant[]>([]);

  const currentParticipant = participants[turnIndex];
  const isLastTurn = turnIndex === participants.length - 1;

  function pickCard(cardIndex: number) {
    if (justPicked || cardStates[cardIndex] !== "hidden") return;
    const isWinner = winnerSlots[cardIndex];
    setCardStates((prev) => prev.map((s, i) => (i === cardIndex ? (isWinner ? "win" : "lose") : s)));
    setJustPicked({ isWinner });
    if (isWinner) setWinners((prev) => [...prev, currentParticipant]);
  }

  function handleNext() {
    if (isLastTurn) {
      onFinish(winners);
      return;
    }
    setTurnIndex((v) => v + 1);
    setJustPicked(null);
  }

  // 2026-08-12 신규: "결과 바로 보기" - 아직 안 뽑은 사람들에게 남은 카드를 임의로 배정해서
  // 한 번에 결과를 확정한다(폰을 계속 돌리지 않고 결과만 빨리 보고 싶을 때).
  function handleRevealAll() {
    const remainingCardIndices = cardStates
      .map((s, i) => (s === "hidden" ? i : -1))
      .filter((i) => i !== -1);
    const remainingParticipants = participants.slice(turnIndex);
    const finalWinners = [...winners];
    remainingParticipants.forEach((p, idx) => {
      const cardIndex = remainingCardIndices[idx];
      if (cardIndex !== undefined && winnerSlots[cardIndex]) finalWinners.push(p);
    });
    onFinish(finalWinners);
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {justPicked ? "결과" : `${currentParticipant.name} 님 차례 - 제비를 골라주세요`}
        </p>
        <button
          onClick={handleRevealAll}
          className="shrink-0 text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline"
        >
          결과 바로 보기
        </button>
      </div>

      <div className="grid w-full grid-cols-4 gap-2">
        {participants.map((_, cardIndex) => (
          <button
            key={cardIndex}
            onClick={() => pickCard(cardIndex)}
            disabled={!!justPicked || cardStates[cardIndex] !== "hidden"}
            className={[
              "flex h-16 flex-col items-center justify-center rounded-xl2 border text-sm font-semibold transition",
              cardStates[cardIndex] === "hidden"
                ? "border-black/10 bg-surface text-ink hover:border-primary"
                : cardStates[cardIndex] === "win"
                  ? "border-primary bg-primary-light text-primary-dark"
                  : "border-black/10 bg-surface-muted text-ink-soft",
            ].join(" ")}
          >
            <span>{cardIndex + 1}</span>
          </button>
        ))}
      </div>

      {justPicked && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-bold text-ink">
            {currentParticipant.name} 님 {justPicked.isWinner ? "당첨!" : "꽝"}
          </p>
          <button
            onClick={handleNext}
            className="rounded-xl2 bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
          >
            {isLastTurn ? "결과 확인하기" : `다음: ${participants[turnIndex + 1].name}님 차례`}
          </button>
        </div>
      )}
    </div>
  );
}
