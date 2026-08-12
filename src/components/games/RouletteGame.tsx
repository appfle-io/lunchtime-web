"use client";

import { useMemo, useState } from "react";
import type { MiniGameParticipant } from "@/types";

interface RouletteGameProps {
  participants: MiniGameParticipant[];
  onFinish: (winner: MiniGameParticipant) => void;
}

// 룰렛은 "인원수만 정하고 시작" 하는 게임이라 항상 1명만 뽑는다(설계 문서 참고). 여러 명을
// 뽑고 싶으면 "이미 나온 사람 빼고 다시 돌리기"를 반복하는 확장을 나중에 고려할 수 있다.
const SPIN_DURATION_MS = 4000;

// 칸 색상 팔레트. 2026-08-12: 예전엔 conic-gradient로 2색을 번갈아 칠했는데, 참가자 수가
// 홀수면 첫 칸과 마지막 칸이 360deg 지점에서 서로 맞닿으면서 같은 색이 되어 두 칸이 하나로
// 뭉쳐 보이는 버그가 있었다(3명일 때 실제로 발생 - 화면에 칸이 2개처럼 보였음). 색만으로
// 구분하지 않고 칸마다 흰 테두리(stroke)를 그려서, 인접한 두 칸이 우연히 같은 색이어도
// 경계가 항상 보이도록 SVG 부채꼴로 다시 그렸다.
const PALETTE = ["#ffe8b3", "#ffd27a", "#ffc4a3", "#ffb3c6", "#c9e4ff", "#c8f4de"];

function polarToCartesian(cx: number, cy: number, r: number, angleFromTopDeg: number) {
  // angleFromTopDeg: 12시 방향이 0deg, 시계방향으로 증가 - targetRotation 계산과 좌표계를 맞추기 위함.
  const rad = ((angleFromTopDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeSlice(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const largeArcFlag = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

export default function RouletteGame({ participants, onFinish }: RouletteGameProps) {
  const n = participants.length;
  const sliceDeg = 360 / n;

  // 미리 당첨자를 하나 무작위로 정해두고, 룰렛 애니메이션은 그 결과에 맞는 각도로만 돌아가게
  // 계산한다 - "돌려보니 우연히 그 사람이 나온 것"처럼 보이지만 실제로는 결과가 먼저 정해져
  // 있고 연출만 나중에 맞추는, 흔한 룰렛 UI 구현 패턴이다.
  const [winnerIndex] = useState(() => Math.floor(Math.random() * n));
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const targetRotation = useMemo(() => {
    const centerDeg = winnerIndex * sliceDeg + sliceDeg / 2;
    const extraSpins = 5 * 360;
    return extraSpins + (360 - centerDeg);
  }, [winnerIndex, sliceDeg]);

  function handleSpin() {
    if (spinning || revealed) return;
    setSpinning(true);
    setRotation(targetRotation);
    setTimeout(() => {
      setSpinning(false);
      setRevealed(true);
    }, SPIN_DURATION_MS);
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="relative h-56 w-56">
        <div
          className="absolute inset-0 transition-transform ease-out"
          style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${SPIN_DURATION_MS}ms` }}
        >
          <svg viewBox="0 0 200 200" className="h-full w-full rounded-full shadow-soft">
            {participants.map((_, i) => (
              <path
                key={i}
                d={describeSlice(100, 100, 98, i * sliceDeg, (i + 1) * sliceDeg)}
                fill={PALETTE[i % PALETTE.length]}
                stroke="#ffffff"
                strokeWidth={3}
              />
            ))}
          </svg>
        </div>
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 text-2xl text-ink">▼</div>
      </div>

      {!revealed && (
        <button
          onClick={handleSpin}
          disabled={spinning}
          className="rounded-xl2 bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40"
        >
          {spinning ? "돌아가는 중..." : "돌리기"}
        </button>
      )}

      {revealed && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-bold text-ink">{participants[winnerIndex].name} 님 당첨!</p>
          <button
            onClick={() => onFinish(participants[winnerIndex])}
            className="rounded-xl2 bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
          >
            결과 확인하기
          </button>
        </div>
      )}
    </div>
  );
}
