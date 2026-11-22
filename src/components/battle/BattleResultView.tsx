"use client";

import { useEffect, useMemo, useState } from "react";
import type { BattleResult, BattleRoomDetail } from "@/types/battle";
import type { RestaurantSummary } from "@/types";

interface BattleResultViewProps {
  room: BattleRoomDetail;
  result: BattleResult;
  restaurants: RestaurantSummary[];
  companyCode: string;
  myNicknameId: string;
  myNickname: string;
  onBackToLobby: () => void;
  onReturnToWaitingRoom?: () => void;
  onNotify?: (message: string) => void;
}

export default function BattleResultView({
  room,
  result,
  restaurants,
  companyCode,
  myNicknameId,
  myNickname,
  onBackToLobby,
  onReturnToWaitingRoom,
  onNotify,
}: BattleResultViewProps) {
  const [copied, setCopied] = useState(false);
  const [isSavedToHistory, setIsSavedToHistory] = useState(false);

  const isTie = Boolean(result.isTie);
  const tiedCandidates = useMemo(
    () => result.tiedCandidates || (result.winner ? [result.winner] : []),
    [result.tiedCandidates, result.winner]
  );

  const winnerRestaurant = result.winner
    ? restaurants.find(
        (r) =>
          r.id === result.winner?.restaurantId ||
          r.name.toLowerCase() === result.winner?.name.toLowerCase()
      )
    : undefined;

  const isHost =
    room.hostNicknameId === myNicknameId ||
    room.hostNickname === myNickname;

  // 방장인 경우 결과를 Firestore 투표 히스토리에 1회 영속 저장 (중복 방지)
  useEffect(() => {
    if (isHost && !isSavedToHistory) {
      setIsSavedToHistory(true);
      const cands = Array.isArray(room.candidates)
        ? room.candidates
        : Object.values(room.candidates || {});
      const players = Array.isArray(room.players)
        ? room.players
        : Object.values(room.players || {});

      const historyTitle = isTie
        ? `[배틀룸 무승부] ${room.title} (${tiedCandidates.map((c) => c.name).join(" vs ")})`
        : `[배틀룸] ${room.title}`;

      fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          creatorNicknameId: myNicknameId,
          creatorNickname: myNickname,
          title: historyTitle,
          options: cands.map((c: any) => ({
            restaurantId: c.restaurantId,
            label: c.name,
          })),
          participantNicknameIds: players.map((p: any) => p.nicknameId),
        }),
      }).catch((err) => {
        console.error("Failed to save battle result to Firestore:", err);
      });
    }
  }, [room, result, companyCode, myNicknameId, myNickname, isSavedToHistory, isHost, isTie, tiedCandidates]);

  const handleCopyResult = () => {
    let text = "";
    if (isTie && tiedCandidates.length >= 2) {
      text = `[오늘의 점심 배틀 결과 - 무승부!]\n동점 메뉴: ${tiedCandidates[0].name} vs ${tiedCandidates[1].name}\n"치열한 접전 끝에 두 메뉴가 동점입니다! 팀원들과 함께 잘 협의해서 골라보세요!"\n참여자: ${room.players.map((p) => p.nickname).join(", ")}`;
    } else if (result.winner) {
      text = `[오늘의 점심 확정]\n선정 메뉴: ${result.winner.name} (${result.winner.category || "식당"})\n참여자: ${room.players.map((p) => p.nickname).join(", ")}`;
    }
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (onNotify) onNotify("결과가 클립보드에 복사되었습니다.");
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface p-6 text-ink overflow-y-auto">
      <div className={`w-full ${isTie ? "max-w-xl" : "max-w-md"} rounded-2xl sm:rounded-3xl border border-black/10 bg-surface p-6 sm:p-7 shadow-soft my-auto`}>
        {/* 상단 뱃지 및 타이틀 */}
        {isTie ? (
          <div className="text-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3.5 py-1 text-xs font-bold text-amber-700 border border-amber-200">
              치열한 접전 · 무승부 (동점)
            </span>
            <h2 className="mt-3 text-xl sm:text-2xl font-black tracking-tight text-ink">
              동점입니다! 메뉴를 잘 협의해보세요
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
              두 메뉴 모두 훌륭하여 표가 완벽히 갈렸습니다. 팀원들과 대화로 결정해보세요.
            </p>
          </div>
        ) : (
          result.winner && (
            <div className="text-center">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                오늘의 점심 메뉴 확정
              </span>
              <h2 className="mt-4 text-2xl sm:text-3xl font-black tracking-tight text-ink">{result.winner.name}</h2>
              <p className="mt-1 text-xs text-ink-soft">
                {result.winner.category || "메뉴"} · 추천: {result.winner.addedByNickname}
              </p>
            </div>
          )
        )}

        {/* 무승부일 때: 두 후보 나란히 카드 표시 */}
        {isTie && tiedCandidates.length >= 2 ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tiedCandidates.slice(0, 2).map((cand, idx) => {
              const matchedRest = restaurants.find(
                (r) =>
                  r.id === cand.restaurantId ||
                  r.name.toLowerCase() === cand.name.toLowerCase()
              );
              return (
                <div
                  key={cand.id || idx}
                  className="flex flex-col justify-between rounded-2xl border border-black/10 bg-surface-muted/60 p-4 text-left shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-bold text-purple-700 border border-purple-200">
                        후보 {idx + 1}
                      </span>
                      {matchedRest?.isZeroPay && (
                        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          제로페이
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 text-base font-black text-ink">{cand.name}</h3>
                    <p className="text-xs text-ink-soft">{cand.category || "메뉴"} · 추천: {cand.addedByNickname}</p>
                    {matchedRest?.address && (
                      <p className="mt-2 text-xs text-ink-soft line-clamp-2">{matchedRest.address}</p>
                    )}
                  </div>
                  {matchedRest?.naverPlaceUrl && (
                    <a
                      href={matchedRest.naverPlaceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-dark"
                    >
                      네이버 지도
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 단독 우승자일 때 기존 식당 상세 카드 */
          winnerRestaurant && (
            <div className="mt-5 rounded-2xl border border-black/5 bg-surface-muted/60 p-4 text-left shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink">{winnerRestaurant.name}</span>
                {winnerRestaurant.isZeroPay && (
                  <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    제로페이 가맹점
                  </span>
                )}
              </div>
              {winnerRestaurant.address && (
                <p className="mt-1 text-xs text-ink-soft">{winnerRestaurant.address}</p>
              )}
              {winnerRestaurant.naverPlaceUrl && (
                <a
                  href={winnerRestaurant.naverPlaceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-dark"
                >
                  네이버 지도 바로가기
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          )
        )}

        {/* 참여자 정보 */}
        <div className="mt-5 border-t border-black/5 pt-4">
          <div className="text-xs font-semibold text-ink-soft mb-2">참여 인원 ({room.players.length}명)</div>
          <div className="flex flex-wrap gap-1.5">
            {room.players.map((p) => (
              <span
                key={p.nicknameId}
                className="rounded-lg bg-surface-muted px-2.5 py-1 text-xs text-ink font-medium border border-black/5"
              >
                {p.nickname}
              </span>
            ))}
          </div>
        </div>

        {/* 액션 버튼 그룹 */}
        <div className="mt-6 flex flex-col gap-2">
          {/* 공유 버튼 */}
          <button
            onClick={handleCopyResult}
            className="w-full rounded-xl bg-primary py-2.5 text-xs sm:text-sm font-bold text-white transition hover:bg-primary-dark shadow-xs"
          >
            {copied ? "복사 완료!" : isTie ? "동점 결과 팀원들에게 공유하기 (클립보드 복사)" : "결과 팀원들에게 공유하기 (클립보드 복사)"}
          </button>

          {/* 다시 하기 (대기실로 복귀) */}
          {onReturnToWaitingRoom && (
            <button
              onClick={onReturnToWaitingRoom}
              className="w-full rounded-xl border border-black/10 bg-surface py-2.5 text-xs font-bold text-ink transition hover:bg-surface-muted"
            >
              대기실로 돌아가기 (다음 판 다시 하기)
            </button>
          )}

          {/* 방 완전히 나가기 */}
          <button
            onClick={onBackToLobby}
            className="w-full rounded-xl border border-transparent py-2 text-xs font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink"
          >
            방 나가기 (로비로 이동)
          </button>
        </div>
      </div>
    </div>
  );
}
