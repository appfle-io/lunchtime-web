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
const RESHUFFLE_DURATION_MS = 550;

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

// 세로줄 하나는 항상 같은 참가자에게 고정 배정된다(맨 위 버튼에 이름 표시) - 누구든 원할 때
// 자기 줄을 클릭하면 된다.
//
// 2026-08-12 4차 수정: "다음 사람에게 넘겨주세요" 중간 화면과, 한 명씩 순서대로 확인하는
// 방식을 없애달라는 피드백을 받았다("클릭이 너무 많아져서 귀찮다" - 인원이 많을수록 매번
// "확인했어요"를 눌러야 해서 번거로웠음). 이제는 한 화면에 사다리를 다 같이 띄워두고, 누구든
// 순서 상관없이 자기 세로줄을 클릭하면 된다. 여러 명이 거의 동시에 눌러도 애니메이션은 한 번에
// 하나씩만 재생되도록 대기열(queue)로 처리하지만, 그 사이에 "확인" 버튼을 누를 필요는 없다.
// 전원이 다 뽑으면 별도 확인 절차 없이 바로 결과 화면으로 넘어간다.
//
// 2026-08-12 5차 수정: 아무도 아직 안 뽑은 상태에서 "다시 그리기"를 눌러 사다리 구조(가로줄
// 배치)와 당첨 위치를 통째로 다시 무작위로 뽑아볼 수 있게 했다 - 마음에 드는 모양이 나올
// 때까지 여러 번 반복하고, 원할 때 실제로 뽑기 시작하면 된다. 한 명이라도 이미 세로줄을
// 골랐으면(claimedColumns에 뭔가 있으면) 다시 그리기는 막아서 이미 진행된 결과가 안 꼬이게 한다.
export default function LadderGame({ participants, winnerCount, onFinish }: LadderGameProps) {
  const n = participants.length;
  const [rungs, setRungs] = useState(() => generateRungs(n));
  const [winnerBottoms, setWinnerBottoms] = useState<Set<number>>(
    () => new Set(shuffleIndices(n).slice(0, winnerCount))
  );

  const [claimedColumns, setClaimedColumns] = useState<Set<number>>(new Set());
  const [queue, setQueue] = useState<number[]>([]);
  const [animatingColumn, setAnimatingColumn] = useState<{ column: number; path: RevealedPath } | null>(null);
  const [revealedPaths, setRevealedPaths] = useState<Record<number, RevealedPath>>({});
  const [winners, setWinners] = useState<MiniGameParticipant[]>([]);
  const [shuffling, setShuffling] = useState(false);

  const hasStarted = claimedColumns.size > 0;

  // 대기열에 쌓인 세로줄을 순서대로 하나씩 애니메이션 처리한다.
  useEffect(() => {
    if (animatingColumn || queue.length === 0) return;
    const [next, ...rest] = queue;
    const { points, finalColumn } = tracePath(rungs, next);
    const isWinner = winnerBottoms.has(finalColumn);
    setQueue(rest);
    setAnimatingColumn({ column: next, path: { points, isWinner, finalColumn } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, animatingColumn]);

  // 애니메이션 지속 시간만큼 기다렸다가 그 줄의 결과를 확정한다.
  useEffect(() => {
    if (!animatingColumn) return;
    const timer = setTimeout(() => {
      setRevealedPaths((prev) => ({ ...prev, [animatingColumn.column]: animatingColumn.path }));
      if (animatingColumn.path.isWinner) {
        setWinners((prev) => [...prev, participants[animatingColumn.column]]);
      }
      setAnimatingColumn(null);
    }, TRACE_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animatingColumn]);

  // 전원(참가자 수만큼)의 세로줄이 다 공개되면 확인 버튼 없이 바로 결과 화면으로 넘어간다.
  useEffect(() => {
    if (n > 0 && Object.keys(revealedPaths).length === n) {
      onFinish(winners);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedPaths]);

  function pickColumn(column: number) {
    if (shuffling || claimedColumns.has(column)) return;
    setClaimedColumns((prev) => new Set(prev).add(column));
    setQueue((prev) => [...prev, column]);
  }

  // "다시 그리기" - 아직 아무도 세로줄을 고르지 않았을 때만 가로줄 배치와 당첨 위치를 통째로
  // 새로 무작위로 뽑아서 원하는 만큼 반복할 수 있게 한다.
  function handleReshuffle() {
    if (shuffling || hasStarted) return;
    setShuffling(true);
    setTimeout(() => {
      setRungs(generateRungs(n));
      setWinnerBottoms(new Set(shuffleIndices(n).slice(0, winnerCount)));
      setShuffling(false);
    }, RESHUFFLE_DURATION_MS);
  }

  // "결과 바로 보기" - 아직 공개 안 된 줄을 전부 한 번에 확정해서 결과 화면으로 넘어간다
  // (애니메이션 대기열 중간이어도 상관없이 즉시 종료).
  function handleRevealAll() {
    const finalWinners = [...winners];
    for (let col = 0; col < n; col++) {
      if (revealedPaths[col]) continue;
      const bottom = traceColumn(rungs, col);
      if (winnerBottoms.has(bottom)) finalWinners.push(participants[col]);
    }
    onFinish(finalWinners);
  }

  // 바닥 칸 index -> 당첨 여부. 실제로 어떤 참가자의 경로가 그 칸까지 도착한 경우에만 채워진다 -
  // 아직 아무도 도착하지 않은 칸은 당첨인지 미리 알 수 없게 "?"로 남겨둔다.
  const finalColumnStatus = new Map<number, boolean>();
  Object.values(revealedPaths).forEach((p) => finalColumnStatus.set(p.finalColumn, p.isWinner));

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex w-full items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {shuffling
            ? "사다리를 다시 그리는 중..."
            : animatingColumn
              ? "사다리를 타고 내려가는 중..."
              : "각자 자기 세로줄을 클릭해서 확인하세요"}
        </p>
        <div className="flex shrink-0 gap-2.5">
          {!hasStarted && (
            <button
              onClick={handleReshuffle}
              disabled={shuffling}
              className="text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline disabled:opacity-40"
            >
              다시 그리기
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

      {/* 실제 사다리 그림: 위쪽 선택 버튼(참가자 이름) - 세로줄+가로줄 SVG - 아래쪽 결과 칸을
          하나의 가로 스크롤 영역 안에 같이 묶어서, 참가자가 많아 옆으로 스크롤해도 세 부분이
          항상 같이 움직여 서로 어긋나지 않게 한다. */}
      <div className="w-full overflow-x-auto">
        <div
          style={{ width: n * COL_WIDTH }}
          className={["mx-auto flex flex-col transition-opacity", shuffling ? "pointer-events-none opacity-40" : ""].join(
            " "
          )}
        >
          <div className="flex">
            {participants.map((p, col) => {
              const revealed = revealedPaths[col];
              const label = revealed ? (revealed.isWinner ? "당첨!" : "꽝") : p.name;
              return (
                <button
                  key={col}
                  onClick={() => pickColumn(col)}
                  disabled={shuffling || claimedColumns.has(col)}
                  title={p.name}
                  style={{ width: COL_WIDTH }}
                  className={[
                    "shrink-0 truncate rounded-t-lg border-x border-t px-1 py-1.5 text-[11px] font-semibold transition",
                    revealed
                      ? revealed.isWinner
                        ? "border-primary bg-primary-light text-primary-dark"
                        : "border-black/10 bg-surface-muted text-ink-soft"
                      : claimedColumns.has(col)
                        ? "border-black/10 bg-surface-muted text-ink-soft"
                        : "border-black/10 bg-surface text-ink hover:border-primary",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
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
    </div>
  );
}
