"use client";

import { useEffect, useRef, useState } from "react";
import type { MiniGameParticipant } from "@/types";

interface LadderGameProps {
  participants: MiniGameParticipant[];
  winnerCount: number;
  onFinish: (winners: MiniGameParticipant[]) => void;
}

const ROWS = 10;
// 2026-08-12 2차 수정: 사용자가 스크린샷을 보고 "이거 제비뽑기랑 뭐가 달라? 내가 아는
// 사다리타기는 위에서 아래로 내려오는 그런건데 이거 이상해"라고 지적 - v1은 사다리 계산 로직만
// 정확하고 화면에는 세로줄 버튼만 나열해서 실제 사다리 모양이 전혀 안 보였다. 여기서부터는
// 세로줄+가로줄을 SVG로 실제로 그리고, 고른 줄이 가로줄을 만날 때마다 옆으로 꺾이며 내려가는
// 경로를 애니메이션으로 보여준다(선택 즉시 결과가 뜨는 제비뽑기와 시각적으로 확실히 구분됨).
const COL_WIDTH = 52;
const ROW_HEIGHT = 22;
const LADDER_HEIGHT = ROWS * ROW_HEIGHT;
const TRACE_DURATION_MS = 900;

// 참가자 수(n)만큼 세로줄을 만들고, 각 행마다 인접한 두 줄 사이에 가로줄(rung)을 무작위로
// 놓는다. 같은 행 안에서 가로줄끼리 겹치면(예: 1-2번 사이와 2-3번 사이가 동시에) 사다리가
// 꼬여 보이므로, 왼쪽부터 순서대로 훑으면서 하나를 놓으면 바로 다음 칸(그 오른쪽 줄이 걸린 칸)은
// 건너뛴다.
function generateRungs(n: number): boolean[][] {
  const rungs: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: boolean[] = new Array(Math.max(0, n - 1)).fill(false);
    let c = 0;
    while (c < n - 1) {
      if (Math.random() < 0.45) {
        row[c] = true;
        c += 2; // 바로 다음 칸은 건너뛰어 겹침 방지
      } else {
        c += 1;
      }
    }
    rungs.push(row);
  }
  return rungs;
}

// 한 행(row)의 가로줄 배치를 보고 현재 칸(col)이 어디로 이동하는지 계산한다. traceColumn(최종
// 도착 칸만 필요할 때)과 tracePath(애니메이션용 전체 경로가 필요할 때)가 이 함수 하나를
// 공유해서, 두 계산 방식이 서로 어긋나는 버그를 원천적으로 막는다.
function stepColumn(row: boolean[], col: number): number {
  if (row[col]) return col + 1;
  if (col > 0 && row[col - 1]) return col - 1;
  return col;
}

// 맨 위 startColumn에서 출발해 rungs를 따라 내려갔을 때 도착하는 맨 아래 칸 번호.
// 사다리(가로줄들의 조합)는 항상 위-아래를 1:1로 잇는 순열(permutation)이 되므로, 당첨 칸을
// 사다리 구조와 무관하게 미리 무작위로 정해둬도 공정성이 그대로 유지된다.
function traceColumn(rungs: boolean[][], startColumn: number): number {
  let col = startColumn;
  for (const row of rungs) col = stepColumn(row, col);
  return col;
}

interface PathPoint {
  x: number;
  y: number;
}

// traceColumn과 같은 로직으로 내려가되, 애니메이션에 쓸 좌표(꺾이는 지점 전부)를 함께 반환한다.
function tracePath(rungs: boolean[][], startColumn: number): { points: PathPoint[]; finalColumn: number } {
  const raw: { col: number; yRatio: number }[] = [];
  let col = startColumn;
  raw.push({ col, yRatio: 0 });
  rungs.forEach((row, r) => {
    const midY = r + 0.5;
    raw.push({ col, yRatio: midY });
    const nextCol = stepColumn(row, col);
    if (nextCol !== col) {
      col = nextCol;
      raw.push({ col, yRatio: midY });
    }
    raw.push({ col, yRatio: r + 1 });
  });
  const points = raw.map((p) => ({ x: (p.col + 0.5) * COL_WIDTH, y: p.yRatio * ROW_HEIGHT }));
  return { points, finalColumn: col };
}

function shuffleIndices(n: number): number[] {
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

type Phase = "turn" | "revealed" | "handoff";

interface RevealedPath {
  points: PathPoint[];
  isWinner: boolean;
  finalColumn: number;
}

// SVG 선을 위에서 아래로 "그려지는" 것처럼 보이게 하는 보조 컴포넌트. getTotalLength()로 실제
// 선 길이를 구해서 stroke-dasharray/dashoffset을 트랜지션시키는 표준적인 SVG 라인 애니메이션
// 기법이라, 지그재그로 꺾이는 사다리 경로에도 그대로 적용된다.
function AnimatedLadderPath({ points, color }: { points: PathPoint[]; color: string }) {
  const ref = useRef<SVGPolylineElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const length = el.getTotalLength();
    el.style.transition = "none";
    el.style.strokeDasharray = `${length}`;
    el.style.strokeDashoffset = `${length}`;
    el.getBoundingClientRect(); // 강제 리플로우 - 아래 transition이 실제로 애니메이션되게 함
    el.style.transition = `stroke-dashoffset ${TRACE_DURATION_MS}ms linear`;
    el.style.strokeDashoffset = "0";
  }, [points]);

  return (
    <polyline
      ref={ref}
      points={points.map((p) => `${p.x},${p.y}`).join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export default function LadderGame({ participants, winnerCount, onFinish }: LadderGameProps) {
  const n = participants.length;
  const [rungs] = useState(() => generateRungs(n));
  const [winnerBottoms] = useState<Set<number>>(() => new Set(shuffleIndices(n).slice(0, winnerCount)));

  const [claimedColumns, setClaimedColumns] = useState<Set<number>>(new Set());
  const [turnIndex, setTurnIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("turn");
  const [lastResult, setLastResult] = useState<{ isWinner: boolean } | null>(null);
  const [winners, setWinners] = useState<MiniGameParticipant[]>([]);
  // 사다리 그림 위에 남아있는, 이미 공개된 경로들(칸 번호 → 경로) + 지금 애니메이션 중인 경로 하나.
  const [revealedPaths, setRevealedPaths] = useState<Record<number, RevealedPath>>({});
  const [animatingColumn, setAnimatingColumn] = useState<{ column: number; path: RevealedPath } | null>(null);

  const currentParticipant = participants[turnIndex];
  const isLastTurn = turnIndex === n - 1;

  // 애니메이션 지속 시간만큼 기다렸다가 실제 결과("당첨!"/"꽝" 문구, 다음 버튼)를 공개한다 -
  // 사다리를 타고 내려가는 걸 보는 재미를 위해 클릭 즉시가 아니라 선이 다 그려진 뒤에 보여준다.
  useEffect(() => {
    if (!animatingColumn) return;
    const timer = setTimeout(() => {
      setRevealedPaths((prev) => ({ ...prev, [animatingColumn.column]: animatingColumn.path }));
      setLastResult({ isWinner: animatingColumn.path.isWinner });
      if (animatingColumn.path.isWinner) {
        setWinners((prev) => [...prev, currentParticipant]);
      }
      setAnimatingColumn(null);
      setPhase("revealed");
    }, TRACE_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animatingColumn]);

  function pickColumn(column: number) {
    if (phase !== "turn" || animatingColumn || claimedColumns.has(column)) return;
    const { points, finalColumn } = tracePath(rungs, column);
    const isWinner = winnerBottoms.has(finalColumn);
    setClaimedColumns((prev) => new Set(prev).add(column));
    setAnimatingColumn({ column, path: { points, isWinner, finalColumn } });
  }

  function handleAfterReveal() {
    if (isLastTurn) {
      onFinish(winners);
      return;
    }
    setPhase("handoff");
  }

  function handleHandoffConfirm() {
    setTurnIndex((v) => v + 1);
    setLastResult(null);
    setPhase("turn");
  }

  // "결과 바로 보기" - 아직 안 고른 사람들에게 남은 세로줄을 임의로 배정해서 한 번에 결과를
  // 확정한다(제비뽑기와 동일한 취지의 단축 버튼). 이 경로는 화면이 곧바로 전환되어 사라지므로
  // 애니메이션 없이 최종 도착 칸만 계산한다.
  function handleRevealAll() {
    const remainingColumns = Array.from({ length: n }, (_, i) => i).filter((c) => !claimedColumns.has(c));
    const remainingParticipants = participants.slice(turnIndex);
    const finalWinners = [...winners];
    remainingParticipants.forEach((p, idx) => {
      const column = remainingColumns[idx];
      if (column === undefined) return;
      const bottom = traceColumn(rungs, column);
      if (winnerBottoms.has(bottom)) finalWinners.push(p);
    });
    onFinish(finalWinners);
  }

  // 바닥 칸 index -> 당첨 여부. 실제로 어떤 참가자의 경로가 그 칸까지 도착한 경우에만 채워진다 -
  // 아직 아무도 도착하지 않은 칸은 당첨인지 미리 알 수 없게 "?"로 남겨둔다.
  const finalColumnStatus = new Map<number, boolean>();
  Object.values(revealedPaths).forEach((p) => finalColumnStatus.set(p.finalColumn, p.isWinner));

  if (phase === "handoff") {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <p className="text-sm text-ink-soft">폰을 다음 사람에게 넘겨주세요</p>
        <p className="text-lg font-bold text-ink">{participants[turnIndex + 1].name} 님 차례</p>
        <button
          onClick={handleHandoffConfirm}
          className="rounded-xl2 bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
        >
          확인했어요
        </button>
        <button
          onClick={handleRevealAll}
          className="text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline"
        >
          결과 바로 보기
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {phase === "revealed"
            ? "결과"
            : animatingColumn
              ? "사다리를 타고 내려가는 중..."
              : `${currentParticipant.name} 님 차례 - 세로줄을 하나 골라주세요`}
        </p>
        <button
          onClick={handleRevealAll}
          disabled={!!animatingColumn}
          className="shrink-0 text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline disabled:opacity-40"
        >
          결과 바로 보기
        </button>
      </div>

      {/* 실제 사다리 그림: 위쪽 선택 버튼 - 세로줄+가로줄 SVG - 아래쪽 결과 칸을 하나의 가로
          스크롤 영역 안에 같이 묶어서, 참가자가 많아 옆으로 스크롤해도 세 부분이 항상 같이
          움직여 서로 어긋나지 않게 한다. */}
      <div className="w-full overflow-x-auto">
        <div style={{ width: n * COL_WIDTH }} className="mx-auto flex flex-col">
          <div className="flex">
            {participants.map((_, col) => (
              <button
                key={col}
                onClick={() => pickColumn(col)}
                disabled={phase !== "turn" || !!animatingColumn || claimedColumns.has(col)}
                style={{ width: COL_WIDTH }}
                className={[
                  "shrink-0 rounded-t-lg border-x border-t py-1.5 text-xs font-semibold transition",
                  claimedColumns.has(col)
                    ? "border-black/10 bg-surface-muted text-ink-soft"
                    : "border-black/10 bg-surface text-ink hover:border-primary",
                ].join(" ")}
              >
                {col + 1}
              </button>
            ))}
          </div>

          <svg width={n * COL_WIDTH} height={LADDER_HEIGHT} viewBox={`0 0 ${n * COL_WIDTH} ${LADDER_HEIGHT}`}>
            {Array.from({ length: n }, (_, col) => (
              <line
                key={`col-${col}`}
                x1={(col + 0.5) * COL_WIDTH}
                y1={0}
                x2={(col + 0.5) * COL_WIDTH}
                y2={LADDER_HEIGHT}
                stroke="#d8d4cd"
                strokeWidth={2}
              />
            ))}
            {rungs.map((row, r) =>
              row.map((hasRung, c) =>
                hasRung ? (
                  <line
                    key={`rung-${r}-${c}`}
                    x1={(c + 0.5) * COL_WIDTH}
                    y1={(r + 0.5) * ROW_HEIGHT}
                    x2={(c + 1.5) * COL_WIDTH}
                    y2={(r + 0.5) * ROW_HEIGHT}
                    stroke="#d8d4cd"
                    strokeWidth={2}
                  />
                ) : null
              )
            )}
            {Object.entries(revealedPaths).map(([col, path]) => (
              <polyline
                key={`revealed-${col}`}
                points={path.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={path.isWinner ? "#ef4444" : "#b8b2a6"}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {animatingColumn && (
              <AnimatedLadderPath
                key={animatingColumn.column}
                points={animatingColumn.path.points}
                color={animatingColumn.path.isWinner ? "#ef4444" : "#b8b2a6"}
              />
            )}
          </svg>

          <div className="flex">
            {Array.from({ length: n }, (_, col) => (
              <div
                key={col}
                style={{ width: COL_WIDTH }}
                className="shrink-0 rounded-b-lg border-x border-b border-black/10 bg-surface-muted py-1.5 text-center text-xs font-semibold"
              >
                {finalColumnStatus.has(col) ? (
                  <span className={finalColumnStatus.get(col) ? "text-primary" : "text-ink-soft"}>
                    {finalColumnStatus.get(col) ? "당첨" : "꽝"}
                  </span>
                ) : (
                  <span className="text-ink-soft/50">?</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {phase === "revealed" && lastResult && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-lg font-bold text-ink">
            {currentParticipant.name} 님 {lastResult.isWinner ? "당첨!" : "꽝"}
          </p>
          <button
            onClick={handleAfterReveal}
            className="rounded-xl2 bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
          >
            {isLastTurn ? "결과 확인하기" : "다음 사람에게 넘기기"}
          </button>
        </div>
      )}
    </div>
  );
}
