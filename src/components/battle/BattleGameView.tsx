"use client";

import { useEffect, useState, useMemo } from "react";
import type { BattleCandidate, BattleRoomDetail, BattleVoteState, BattleWorldcupMatch } from "@/types/battle";

interface BattleGameViewProps {
  room: BattleRoomDetail;
  myNicknameId: string;
  voteState: BattleVoteState | null;
  worldcupMatch: BattleWorldcupMatch | null;
  onCastVote: (candidateId: string) => void;
}

const ROULETTE_PALETTE = [
  "#ffe8b3",
  "#ffd27a",
  "#ffc4a3",
  "#ffb3c6",
  "#c9e4ff",
  "#c8f4de",
  "#e1d4fc",
  "#fed7aa",
];

function polarToCartesian(cx: number, cy: number, r: number, angleFromTopDeg: number) {
  const rad = ((angleFromTopDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeSlice(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const largeArcFlag = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

export default function BattleGameView({
  room,
  myNicknameId,
  voteState,
  worldcupMatch,
  onCastVote,
}: BattleGameViewProps) {
  // 타이머 계산 (기본 60초)
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [rouletteRotation, setRouletteRotation] = useState<number>(0);

  const candidatesList: BattleCandidate[] = useMemo(() => {
    if (Array.isArray(room.candidates)) return room.candidates;
    if (room.candidates && typeof room.candidates === "object") {
      return Object.values(room.candidates) as BattleCandidate[];
    }
    return [];
  }, [room.candidates]);

  // 룰렛 회전판 스핀 애니메이션 설정
  useEffect(() => {
    if (room.gameMode === "roulette" && candidatesList.length > 0) {
      const winnerId = room.rouletteState?.winnerCandidateId;
      const winnerIdx = winnerId
        ? candidatesList.findIndex((c) => c.id === winnerId)
        : 0;
      const targetIdx = winnerIdx >= 0 ? winnerIdx : 0;

      const n = candidatesList.length;
      const sliceDeg = 360 / n;
      const centerDeg = targetIdx * sliceDeg + sliceDeg / 2;
      const extraSpins = 5 * 360; // 5바퀴 회전
      const targetAngle = extraSpins + (360 - centerDeg);

      // 시작 직후 부드럽게 회전 시작
      const timer = setTimeout(() => {
        setRouletteRotation(targetAngle);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [room.gameMode, room.rouletteState, candidatesList]);

  // 카운트다운 타이머
  useEffect(() => {
    if (room.gameMode === "speed-vote" && voteState) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - (voteState.startedAt || Date.now())) / 1000);
        const remaining = Math.max((voteState.durationSeconds || 60) - elapsed, 0);
        setTimeLeft(remaining);
      }, 200);
      return () => clearInterval(interval);
    } else if (room.gameMode === "worldcup" && worldcupMatch) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - (worldcupMatch.startedAt || Date.now())) / 1000);
        const remaining = Math.max((worldcupMatch.durationSeconds || 60) - elapsed, 0);
        setTimeLeft(remaining);
      }, 200);
      return () => clearInterval(interval);
    }
  }, [room.gameMode, voteState, worldcupMatch]);

  // 1. 스피드 투표 모드
  if (room.gameMode === "speed-vote") {
    const rawVotes: Record<string, string> =
      voteState && typeof voteState.votes === "object" && voteState.votes !== null
        ? voteState.votes
        : {};
    const myVoteCandidateId = rawVotes[myNicknameId];
    const totalVotes = Object.keys(rawVotes).length;
    const maxDuration = voteState?.durationSeconds || 60;

    return (
      <div className="flex h-full flex-col bg-surface p-5 sm:p-6 text-ink overflow-hidden">
        {/* 상단 헤더 */}
        <div className="mb-4 flex items-center justify-between border-b border-black/5 pb-3.5 shrink-0">
          <div>
            <span className="rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/20">
              실시간 스피드 투표 (최대 1분)
            </span>
            <h2 className="mt-1 text-base sm:text-lg font-bold tracking-tight text-ink">
              가장 먹고 싶은 메뉴를 선택하세요
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] text-ink-soft font-mono">남은 시간</div>
              <div className="text-2xl font-black font-mono text-primary">{timeLeft}초</div>
            </div>
          </div>
        </div>

        {/* 진행 게이지 바 */}
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-muted shrink-0">
          <div
            className="h-full bg-primary transition-all duration-300 ease-linear rounded-full"
            style={{ width: `${(timeLeft / maxDuration) * 100}%` }}
          />
        </div>

        {/* 투표 후보 목록 */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-0">
          {candidatesList.map((cand) => {
            const voteCount = Object.values(rawVotes).filter((id) => id === cand.id).length;
            const votePercent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const isSelected = myVoteCandidateId === cand.id;

            return (
              <button
                key={cand.id}
                onClick={() => onCastVote(cand.id)}
                className={`relative w-full overflow-hidden rounded-2xl border p-3.5 sm:p-4 text-left transition ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-xs"
                    : "border-black/10 bg-surface hover:border-black/20 hover:bg-surface-muted/50 shadow-xs"
                }`}
              >
                {/* 실시간 득표 바 배경 */}
                <div
                  className="absolute inset-0 bg-primary/10 transition-all duration-300 pointer-events-none"
                  style={{ width: `${votePercent}%` }}
                />

                <div className="relative flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm sm:text-base font-bold text-ink">{cand.name}</span>
                      {cand.category && (
                        <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
                          {cand.category}
                        </span>
                      )}
                      {isSelected && (
                        <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                          내 선택
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">추천자: {cand.addedByNickname}</p>
                  </div>

                  <div className="text-right">
                    <div className="text-base font-bold font-mono text-ink">{voteCount}표</div>
                    <div className="text-xs text-ink-soft font-mono">{votePercent}%</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-black/5 pt-3 text-center text-xs text-ink-soft shrink-0">
          총 {room.players.length}명 중 {totalVotes}명 투표 완료 · 전원 투표 시 즉시 종료되며, 시간 종료 시 최다 득표 메뉴로 확정됩니다.
        </div>
      </div>
    );
  }

  // 2. 월드컵 토너먼트 모드
  if (room.gameMode === "worldcup") {
    const votesA: string[] = Array.isArray(worldcupMatch?.votesA)
      ? worldcupMatch.votesA
      : typeof worldcupMatch?.votesA === "object" && worldcupMatch?.votesA !== null
      ? Object.keys(worldcupMatch.votesA)
      : [];

    const votesB: string[] = Array.isArray(worldcupMatch?.votesB)
      ? worldcupMatch.votesB
      : typeof worldcupMatch?.votesB === "object" && worldcupMatch?.votesB !== null
      ? Object.keys(worldcupMatch.votesB)
      : [];

    const candA = worldcupMatch?.candidateA || candidatesList[0];
    const candB = worldcupMatch?.candidateB || candidatesList[1];

    const isVotedA = candA && (votesA.includes(myNicknameId) || votesA.includes(room.hostNickname));
    const isVotedB = candB && (votesB.includes(myNicknameId) || votesB.includes(room.hostNickname));
    const totalMatchVotes = votesA.length + votesB.length;
    const maxDuration = worldcupMatch?.durationSeconds || 60;

    return (
      <div className="flex h-full flex-col bg-surface p-5 sm:p-6 text-ink overflow-hidden">
        <div className="mb-4 flex items-center justify-between border-b border-black/5 pb-3.5 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
              메뉴 이상형 월드컵
            </span>
            <span className="font-bold text-ink text-sm sm:text-base">
              {worldcupMatch?.roundName || "결승전"}
            </span>
            {worldcupMatch?.byeCandidate && (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                부전승 대기: {worldcupMatch.byeCandidate.name}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] text-ink-soft font-mono">남은 시간</div>
            <div className="font-mono text-2xl font-black text-primary">{timeLeft}초</div>
          </div>
        </div>

        {/* 진행 게이지 바 */}
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-muted shrink-0">
          <div
            className="h-full bg-purple-600 transition-all duration-300 ease-linear rounded-full"
            style={{ width: `${(timeLeft / maxDuration) * 100}%` }}
          />
        </div>

        {/* 1:1 대결 화면 */}
        <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 min-h-0">
          {/* 후보 A */}
          {candA && (
            <button
              onClick={() => onCastVote(candA.id)}
              className={`flex flex-col justify-between rounded-2xl border p-5 text-left transition ${
                isVotedA
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-black/10 bg-surface hover:border-primary/40 hover:bg-surface-muted/50 shadow-xs"
              }`}
            >
              <div>
                <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-soft">
                  후보 1
                </span>
                <h3 className="mt-3 text-xl font-black text-ink">{candA.name}</h3>
                <p className="text-xs text-ink-soft mt-1">{candA.category || "메뉴"}</p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
                <span className="text-xs text-ink-soft">추천: {candA.addedByNickname}</span>
                <span className="font-mono text-base font-bold text-primary">{votesA.length}표</span>
              </div>
            </button>
          )}

          {/* 후보 B */}
          {candB && (
            <button
              onClick={() => onCastVote(candB.id)}
              className={`flex flex-col justify-between rounded-2xl border p-5 text-left transition ${
                isVotedB
                  ? "border-purple-500 bg-purple-50/50 shadow-md"
                  : "border-black/10 bg-surface hover:border-purple-300 hover:bg-surface-muted/50 shadow-xs"
              }`}
            >
              <div>
                <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-soft">
                  후보 2
                </span>
                <h3 className="mt-3 text-xl font-black text-ink">{candB.name}</h3>
                <p className="text-xs text-ink-soft mt-1">{candB.category || "메뉴"}</p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
                <span className="text-xs text-ink-soft">추천: {candB.addedByNickname}</span>
                <span className="font-mono text-base font-bold text-purple-700">{votesB.length}표</span>
              </div>
            </button>
          )}
        </div>

        <div className="mt-3 text-center text-xs text-ink-soft shrink-0">
          더 먹고 싶은 메뉴를 선택하세요 · 전원 투표 시 즉시 다음 단계로 넘어가며 다수결로 승자가 결정됩니다 ({totalMatchVotes}/{room.players.length}명 참여)
        </div>
      </div>
    );
  }

  // 3. 운명의 룰렛 모드 (원형 룰렛 돌림판)
  const n = Math.max(candidatesList.length, 1);
  const sliceDeg = 360 / n;

  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface p-4 sm:p-6 text-center text-ink overflow-hidden">
      <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 mb-2 shrink-0">
        운명의 룰렛 추첨 중
      </div>
      <h2 className="text-lg sm:text-xl font-bold text-ink mb-4 shrink-0">
        오늘의 점심 메뉴를 고르고 있습니다...
      </h2>

      {/* 원형 룰렛 컨테이너 */}
      <div className="relative flex items-center justify-center my-auto">
        {/* 상단 인디케이터 화살표 핀 */}
        <div className="absolute top-[-10px] left-1/2 -translate-x-1/2 z-20 text-2xl font-bold text-primary drop-shadow-md">
          ▼
        </div>

        {/* 회전하는 룰렛 원판 */}
        <div
          className="relative h-64 w-64 sm:h-72 sm:w-72 rounded-full border-4 border-white shadow-xl overflow-hidden"
          style={{
            transform: `rotate(${rouletteRotation}deg)`,
            transition: "transform 4.8s cubic-bezier(0.12, 0.8, 0.32, 1)",
          }}
        >
          <svg viewBox="0 0 200 200" className="h-full w-full">
            {candidatesList.map((cand, i) => {
              const startAngle = i * sliceDeg;
              const endAngle = (i + 1) * sliceDeg;
              const midAngle = startAngle + sliceDeg / 2;
              const textPos = polarToCartesian(100, 100, 62, midAngle);

              return (
                <g key={cand.id || i}>
                  <path
                    d={describeSlice(100, 100, 98, startAngle, endAngle)}
                    fill={ROULETTE_PALETTE[i % ROULETTE_PALETTE.length]}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                  {/* 슬라이스 텍스트 */}
                  <text
                    x={textPos.x}
                    y={textPos.y}
                    fill="#1f2937"
                    fontSize={n > 6 ? "7.5" : "9.5"}
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${midAngle + 90}, ${textPos.x}, ${textPos.y})`}
                  >
                    {cand.name.length > 6 ? cand.name.slice(0, 5) + "…" : cand.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* 룰렛 중앙 허브 캡 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white border-2 border-primary shadow-md flex items-center justify-center z-10">
            <div className="h-3 w-3 rounded-full bg-primary" />
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-soft shrink-0">
        등록된 후보 {candidatesList.length}개 중 하나가 실시간으로 추첨됩니다.
      </p>
    </div>
  );
}

