"use client";

import { useEffect, useState } from "react";
import type { MiniGameParticipant, MiniGameRankingEntry, MiniGameResult, MiniGameType } from "@/types";
import ParticipantPicker from "./ParticipantPicker";
import DrawGame from "./games/DrawGame";
import RouletteGame from "./games/RouletteGame";
import LadderGame from "./games/LadderGame";
import TeamSplitGame, { type MiniGameTeamDraft } from "./games/TeamSplitGame";

interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

interface MiniGameModalProps {
  open: boolean;
  companyCode: string;
  myNicknameId: string;
  myNickname: string;
  companyUsers: CompanyUserEntry[];
  onClose: () => void;
  onNotify?: (message: string) => void;
}

type Step = "select" | "setup" | "playing" | "result" | "ranking";
type LeftoverMode = "spread" | "leftover";

interface GameDef {
  type: MiniGameType;
  title: string;
  description: string;
}

// 2026-08-12 신규: "밥시간 미니게임" - 가위바위보는 구현 우선순위가 낮아 빼고, 제비뽑기/룰렛/
// 사다리타기/팀나누기 4종으로 확정(기획/미니게임_설계.md v2 참고). 새 게임을 추가할 땐 이
// 목록에 카드 하나 + games/ 폴더에 컴포넌트 하나만 늘리면 된다 - 참가자 등록/결과 저장/랭킹
// 같은 공통 골격은 이 모달이 전부 담당한다. (2026-08-12 수정: UI 이모지는 최대한 자제하기로 해서
// 텍스트 라벨만 쓴다.)
const GAMES: GameDef[] = [
  { type: "draw", title: "제비뽑기", description: "인원수만큼 제비를 만들고 하나씩 뽑아서 당첨자를 정해요." },
  { type: "roulette", title: "룰렛", description: "이름이 가려진 원형 룰렛을 돌려서 1명을 뽑아요." },
  { type: "ladder", title: "사다리타기", description: "사다리를 타고 내려가서 당첨자를 정해요." },
  { type: "teams", title: "팀 나누기", description: "인원을 무작위로 여러 팀으로 나눠요." },
];

export default function MiniGameModal({
  open,
  companyCode,
  myNicknameId,
  myNickname,
  companyUsers,
  onClose,
  onNotify,
}: MiniGameModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [selectedGame, setSelectedGame] = useState<GameDef | null>(null);
  const [participants, setParticipants] = useState<MiniGameParticipant[]>([]);
  const [winnerCount, setWinnerCount] = useState(1);
  const [teamCount, setTeamCount] = useState(2);
  const [leftoverMode, setLeftoverMode] = useState<LeftoverMode>("spread");
  const [lastResult, setLastResult] = useState<MiniGameResult | null>(null);
  const [ranking, setRanking] = useState<MiniGameRankingEntry[]>([]);
  const [rankingPeriod, setRankingPeriod] = useState<"week" | "month" | "all">("week");
  const [rankingLoading, setRankingLoading] = useState(false);

  // 모달을 열 때마다 게임 선택 화면부터 다시 시작한다 - 참가자 구성은 매번 다를 수 있어서
  // 지난 설정을 남겨두면 오히려 헷갈린다(LunchRouletteModal의 조건 유지 방침과는 다르게,
  // 여기는 매번 새로 구성하는 게 자연스럽다고 판단). 나 자신은 항상 기본 참가자로 미리 넣는다.
  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSelectedGame(null);
    setParticipants([{ id: myNicknameId, name: myNickname, nicknameId: myNicknameId, isGuest: false }]);
    setWinnerCount(1);
    setTeamCount(2);
    setLeftoverMode("spread");
    setLastResult(null);
  }, [open, myNicknameId, myNickname]);

  if (!open) return null;

  function selectGame(game: GameDef) {
    setSelectedGame(game);
    setStep("setup");
  }

  async function saveResult(payload: {
    type: MiniGameType;
    winnerCount?: number;
    winners?: MiniGameParticipant[];
    teamCount?: number;
    teams?: MiniGameTeamDraft[];
    leftover?: MiniGameParticipant[];
  }) {
    try {
      const res = await fetch("/api/minigames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, ...payload, participants }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastResult(data.result);
      } else {
        onNotify?.(data.error ?? "결과 저장에 실패했어요.");
      }
    } catch {
      onNotify?.("결과 저장에 실패했어요 - 랭킹에는 반영되지 않을 수 있어요.");
    }
  }

  function handleWinnersFinished(winners: MiniGameParticipant[]) {
    if (!selectedGame) return;
    setStep("result");
    saveResult({ type: selectedGame.type, winnerCount, winners });
  }

  function handleTeamsFinished(teams: MiniGameTeamDraft[], leftover: MiniGameParticipant[]) {
    setStep("result");
    saveResult({ type: "teams", teamCount, teams, leftover });
  }

  async function loadRanking(period: "week" | "month" | "all") {
    setRankingPeriod(period);
    setRankingLoading(true);
    try {
      const res = await fetch(`/api/minigames?companyCode=${encodeURIComponent(companyCode)}&period=${period}`);
      const data = await res.json();
      setRanking(data.ranking ?? []);
    } catch {
      onNotify?.("랭킹을 불러오지 못했어요.");
    } finally {
      setRankingLoading(false);
    }
  }

  function openRanking() {
    setStep("ranking");
    loadRanking(rankingPeriod);
  }

  function handleRestart() {
    setStep("select");
    setSelectedGame(null);
    setLastResult(null);
  }

  const maxWinnerCount = Math.max(1, participants.length - 1);
  const winnerCountInvalid = selectedGame?.type !== "teams" && winnerCount >= participants.length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl2 bg-surface p-6 text-center shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {step === "select" || step === "ranking" ? "미니게임" : (selectedGame?.title ?? "")}
          </h3>
          <button onClick={onClose} aria-label="닫기" className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted">
            ✕
          </button>
        </div>

        {step === "select" && (
          <div className="flex flex-col gap-2 text-left">
            {GAMES.map((g) => (
              <button
                key={g.type}
                onClick={() => selectGame(g)}
                className="flex items-start gap-3 rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5 text-left transition hover:border-primary/40"
              >
                <span>
                  <span className="block text-sm font-semibold text-ink">{g.title}</span>
                  <span className="block text-xs text-ink-soft">{g.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {step === "setup" && selectedGame && (
          <div className="flex flex-col gap-4 text-left">
            {selectedGame.type !== "roulette" && (
              <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
                <label className="mb-1.5 block text-xs font-medium text-ink-soft">
                  {selectedGame.type === "teams" ? "몇 팀으로 나눌까요?" : "당첨자 수"}
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      selectedGame.type === "teams"
                        ? setTeamCount((v) => Math.max(2, v - 1))
                        : setWinnerCount((v) => Math.max(1, v - 1))
                    }
                    className="h-8 w-8 rounded-full border border-black/10 text-sm font-semibold transition hover:border-primary"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-bold text-ink">
                    {selectedGame.type === "teams" ? teamCount : winnerCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      selectedGame.type === "teams"
                        ? setTeamCount((v) => v + 1)
                        : setWinnerCount((v) => Math.min(maxWinnerCount, v + 1))
                    }
                    className="h-8 w-8 rounded-full border border-black/10 text-sm font-semibold transition hover:border-primary"
                  >
                    +
                  </button>
                  <span className="text-xs text-ink-soft">{selectedGame.type === "teams" ? "팀" : "명"}</span>
                </div>
              </div>
            )}

            {selectedGame.type === "teams" && (
              <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
                <p className="mb-2 text-xs font-medium text-ink-soft">인원이 딱 안 나눠떨어질 때</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLeftoverMode("spread")}
                    className={[
                      "flex-1 rounded-xl px-2 py-2 text-xs font-medium transition",
                      leftoverMode === "spread"
                        ? "bg-primary text-white"
                        : "bg-surface text-ink-soft ring-1 ring-inset ring-black/10",
                    ].join(" ")}
                  >
                    자연스럽게 분배
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftoverMode("leftover")}
                    className={[
                      "flex-1 rounded-xl px-2 py-2 text-xs font-medium transition",
                      leftoverMode === "leftover"
                        ? "bg-primary text-white"
                        : "bg-surface text-ink-soft ring-1 ring-inset ring-black/10",
                    ].join(" ")}
                  >
                    깍두기로 분리
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
              <p className="mb-2 text-sm font-semibold text-ink">참가자 등록</p>
              <ParticipantPicker
                companyCode={companyCode}
                companyUsers={companyUsers}
                participants={participants}
                onChange={setParticipants}
              />
            </div>

            <p className="text-xs text-ink-soft">
              참가자 <span className="font-semibold text-ink">{participants.length}명</span>
            </p>

            {winnerCountInvalid && (
              <p className="text-xs text-red-500">당첨자 수는 참가자 수보다 적어야 해요.</p>
            )}

            <button
              onClick={() => setStep("playing")}
              disabled={
                participants.length < 2 ||
                winnerCountInvalid ||
                (selectedGame.type === "teams" && teamCount < 2)
              }
              className="w-full rounded-xl2 bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40"
            >
              시작하기
            </button>
          </div>
        )}

        {step === "playing" && selectedGame?.type === "draw" && (
          <DrawGame participants={participants} winnerCount={winnerCount} onFinish={handleWinnersFinished} />
        )}
        {step === "playing" && selectedGame?.type === "roulette" && (
          <RouletteGame participants={participants} onFinish={(winner) => handleWinnersFinished([winner])} />
        )}
        {step === "playing" && selectedGame?.type === "ladder" && (
          <LadderGame participants={participants} winnerCount={winnerCount} onFinish={handleWinnersFinished} />
        )}
        {step === "playing" && selectedGame?.type === "teams" && (
          <TeamSplitGame
            participants={participants}
            teamCount={teamCount}
            leftoverMode={leftoverMode}
            onFinish={handleTeamsFinished}
          />
        )}

        {step === "result" && selectedGame && (
          <div className="flex flex-col items-center gap-3">
            {selectedGame.type === "teams" ? (
              <>
                <p className="text-base font-bold text-ink">팀이 나눠졌어요!</p>
                <div className="flex w-full flex-col gap-2 text-left">
                  {(lastResult?.teams ?? []).map((team, i) => (
                    <div key={i} className="rounded-xl2 bg-surface-muted p-3">
                      <p className="mb-1 text-xs font-semibold text-ink-soft">{team.name || `${i + 1}팀`}</p>
                      <p className="text-sm text-ink">{team.members.map((m) => m.name).join(", ")}</p>
                    </div>
                  ))}
                  {lastResult?.leftover && lastResult.leftover.length > 0 && (
                    <div className="rounded-xl2 border border-dashed border-black/15 p-3">
                      <p className="mb-1 text-xs font-semibold text-ink-soft">깍두기</p>
                      <p className="text-sm text-ink">{lastResult.leftover.map((m) => m.name).join(", ")}</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-base font-bold text-ink">당첨자는...</p>
                <p className="text-xl font-bold text-primary">
                  {(lastResult?.winners ?? []).map((w) => w.name).join(", ") || "-"}
                </p>
              </>
            )}

            <div className="flex w-full gap-2">
              <button
                onClick={handleRestart}
                className="flex-1 rounded-xl2 border border-black/10 px-3 py-2.5 text-sm font-semibold text-ink transition hover:border-primary hover:text-primary"
              >
                새 게임 시작
              </button>
              {selectedGame.type !== "teams" && (
                <button
                  onClick={openRanking}
                  className="flex-1 rounded-xl2 bg-ink px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
                >
                  랭킹 보기
                </button>
              )}
            </div>
          </div>
        )}

        {step === "ranking" && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1.5">
              {(["week", "month", "all"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => loadRanking(p)}
                  className={[
                    "flex-1 rounded-xl px-2 py-2 text-xs font-medium transition",
                    rankingPeriod === p
                      ? "bg-primary text-white"
                      : "bg-surface text-ink-soft ring-1 ring-inset ring-black/10",
                  ].join(" ")}
                >
                  {p === "week" ? "이번 주" : p === "month" ? "이번 달" : "종합"}
                </button>
              ))}
            </div>

            {rankingLoading && <p className="text-xs text-ink-soft">불러오는 중...</p>}
            {!rankingLoading && ranking.length === 0 && (
              <p className="text-xs text-ink-soft">아직 당첨 기록이 없어요. (게스트 참가자는 랭킹에 집계되지 않아요)</p>
            )}
            {!rankingLoading && ranking.length > 0 && (
              <ol className="flex flex-col gap-1.5 text-left">
                {ranking.map((entry, i) => (
                  <li
                    key={entry.nicknameId}
                    className="flex items-center justify-between rounded-xl2 bg-surface-muted px-3 py-2"
                  >
                    <span className="text-sm text-ink">
                      {i + 1}. {entry.nickname}
                    </span>
                    <span className="text-xs font-semibold text-ink-soft">{entry.winCount}회</span>
                  </li>
                ))}
              </ol>
            )}

            <button
              onClick={handleRestart}
              className="w-full rounded-xl2 border border-black/10 px-3 py-2.5 text-sm font-semibold text-ink transition hover:border-primary hover:text-primary"
            >
              새 게임 시작
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
