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

// 제비뽑기: 참가자 수만큼 제비 칸을 만들고, 그중 당첨자 수만큼만 미리 무작위로 "당첨"을
// 배정해둔다(칸 위치는 섞어서 아무도 어느 칸이 당첨인지 미리 알 수 없다). 카드 하나는 항상 같은
// 참가자에게 고정 배정되고(칸 아래 이름 표시), 그 사람이 원할 때 자기 카드를 클릭하면 된다.
//
// 2026-08-12 3차 수정: "다음 사람에게 넘겨주세요"/"다음: OOO님 차례" 처럼 한 명씩 순서대로
// 폰을 넘겨받아 진행하는 방식은 인원이 많아질수록 클릭 수가 계속 늘어나서 번거롭다는 피드백을
// 받았다 - 한 화면을 다 같이 보면서 각자 자기 카드를 원하는 순서로 클릭하면 되는 방식으로
// 바꿨다. 순서를 강제하지 않으므로 "차례" 개념 자체가 없어졌고, 모든 카드가 뽑히면 확인 버튼
// 없이 바로 결과 화면으로 넘어간다.
export default function DrawGame({ participants, winnerCount, onFinish }: DrawGameProps) {
  const [winnerSlots] = useState<boolean[]>(() =>
    shuffle(participants.map((_, i) => i < winnerCount))
  );
  const [cardStates, setCardStates] = useState<CardState[]>(() =>
    participants.map(() => "hidden" as CardState)
  );
  const [winners, setWinners] = useState<MiniGameParticipant[]>([]);

  // 카드가 전부(=참가자 전원) 뽑히면 별도 확인 버튼 없이 바로 결과 화면으로 넘어간다.
  useEffect(() => {
    if (participants.length > 0 && cardStates.every((s) => s !== "hidden")) {
      onFinish(winners);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardStates]);

  function pickCard(cardIndex: number) {
    if (cardStates[cardIndex] !== "hidden") return;
    const isWinner = winnerSlots[cardIndex];
    setCardStates((prev) => prev.map((s, i) => (i === cardIndex ? (isWinner ? "win" : "lose") : s)));
    if (isWinner) setWinners((prev) => [...prev, participants[cardIndex]]);
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
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">각자 자기 카드를 클릭해서 확인하세요</p>
        <button
          onClick={handleRevealAll}
          className="shrink-0 text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline"
        >
          결과 바로 보기
        </button>
      </div>

      <div className="grid w-full grid-cols-3 gap-2">
        {participants.map((p, cardIndex) => (
          <button
            key={cardIndex}
            onClick={() => pickCard(cardIndex)}
            disabled={cardStates[cardIndex] !== "hidden"}
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
