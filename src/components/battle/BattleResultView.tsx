"use client";

import { useEffect, useState } from "react";
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

  const matchedRestaurant = restaurants.find(
    (r) =>
      r.id === result.winner.restaurantId ||
      r.name.toLowerCase() === result.winner.name.toLowerCase()
  );

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

      fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          creatorNicknameId: myNicknameId,
          creatorNickname: myNickname,
          title: `[배틀룸] ${room.title}`,
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
  }, [room, result, companyCode, myNicknameId, myNickname, isSavedToHistory, isHost]);

  const handleCopyResult = () => {
    const text = `[오늘의 점심 확정]\n선정 메뉴: ${result.winner.name} (${result.winner.category || "식당"})\n참여자: ${room.players.map((p) => p.nickname).join(", ")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (onNotify) onNotify("결과가 클립보드에 복사되었습니다.");
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface p-6 text-ink overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl sm:rounded-3xl border border-black/10 bg-surface p-6 sm:p-7 shadow-soft my-auto">
        {/* 상단 뱃지 */}
        <div className="text-center">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
            오늘의 점심 메뉴 확정
          </span>
          <h2 className="mt-4 text-2xl sm:text-3xl font-black tracking-tight text-ink">{result.winner.name}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {result.winner.category || "메뉴"} · 추천: {result.winner.addedByNickname}
          </p>
        </div>

        {/* 매칭된 식당 상세 카드 */}
        {matchedRestaurant && (
          <div className="mt-5 rounded-2xl border border-black/5 bg-surface-muted/60 p-4 text-left shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-ink">{matchedRestaurant.name}</span>
              {matchedRestaurant.isZeroPay && (
                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  제로페이 가맹점
                </span>
              )}
            </div>
            {matchedRestaurant.address && (
              <p className="mt-1 text-xs text-ink-soft">{matchedRestaurant.address}</p>
            )}
            {matchedRestaurant.naverPlaceUrl && (
              <a
                href={matchedRestaurant.naverPlaceUrl}
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
            {copied ? "복사 완료!" : "결과 팀원들에게 공유하기 (클립보드 복사)"}
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
