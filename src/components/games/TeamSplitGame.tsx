"use client";

import { useState } from "react";
import type { MiniGameParticipant } from "@/types";

export interface MiniGameTeamDraft {
  name: string;
  members: MiniGameParticipant[];
}

interface TeamSplitGameProps {
  participants: MiniGameParticipant[];
  teamCount: number;
  // "spread": 나머지 인원만큼 앞 팀부터 한 명씩 더 받는다(자연스러운 분배).
  // "leftover": 나머지 인원을 어느 팀에도 속하지 않는 "깍두기"로 따로 뺀다.
  leftoverMode: "spread" | "leftover";
  onFinish: (teams: MiniGameTeamDraft[], leftover: MiniGameParticipant[]) => void;
}

const SHUFFLE_DURATION_MS = 2200;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 팀 나누기: 당첨/탈락 개념이 없는 게임이라 랭킹에는 반영되지 않는다(설계 문서 참고). "나누기"를
// 누르면 잠깐 섞는 연출을 보여준 뒤 무작위로 팀을 배정한다.
export default function TeamSplitGame({
  participants,
  teamCount,
  leftoverMode,
  onFinish,
}: TeamSplitGameProps) {
  const [shuffling, setShuffling] = useState(false);

  function handleSplit() {
    setShuffling(true);
    setTimeout(() => {
      const shuffled = shuffle(participants);
      const teams: MiniGameTeamDraft[] = Array.from({ length: teamCount }, (_, i) => ({
        name: `${i + 1}팀`,
        members: [],
      }));
      const leftover: MiniGameParticipant[] = [];

      if (leftoverMode === "leftover") {
        const perTeam = Math.floor(shuffled.length / teamCount);
        shuffled.forEach((p, i) => {
          const teamIndex = Math.floor(i / perTeam);
          if (teamIndex < teamCount) teams[teamIndex].members.push(p);
          else leftover.push(p);
        });
      } else {
        // 자연스럽게 분배: 앞 팀부터 순서대로 한 명씩 나눠준다(라운드로빈) - 나머지 인원이
        // 자동으로 앞쪽 팀에 한 명씩 더 들어가는 효과가 생긴다.
        shuffled.forEach((p, i) => {
          teams[i % teamCount].members.push(p);
        });
      }

      setShuffling(false);
      onFinish(teams, leftover);
    }, SHUFFLE_DURATION_MS);
  }

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      {!shuffling ? (
        <button
          onClick={handleSplit}
          className="rounded-xl2 bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-black"
        >
          나누기
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-ink [animation-delay:-0.2s]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-ink [animation-delay:-0.1s]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-ink" />
          </div>
          <p className="text-sm text-ink-soft">팀을 섞는 중...</p>
        </div>
      )}
    </div>
  );
}
