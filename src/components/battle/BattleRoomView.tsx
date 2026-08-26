"use client";

import { useState, useRef, useEffect } from "react";
import type { BattleCandidate, BattleChatMessage, BattlePlayer, BattleRoomDetail } from "@/types/battle";
import type { RestaurantSummary } from "@/types";
import BattleRestaurantPickerModal from "./BattleRestaurantPickerModal";

interface BattleRoomViewProps {
  room: BattleRoomDetail;
  myNicknameId: string;
  myNickname: string;
  restaurants: RestaurantSummary[];
  onLeave: () => void;
  onTransferHost?: (targetNicknameId: string) => void;
  onToggleReady: () => void;
  onPickRestaurant: (restaurant: {
    id?: string;
    name: string;
    category?: string;
    roadAddress?: string;
    zeroPay?: boolean;
  }) => void;
  onSelectCandidateAsMyPick: (cand: BattleCandidate) => void;
  onRemoveCandidate: (candId: string) => void;
  onDirectAddCandidate: (name: string, category?: string) => void;
  onSendMessage: (content: string) => void;
  onStartGame: () => Promise<{ success: boolean; error?: string }>;
  messages: BattleChatMessage[];
}

export default function BattleRoomView({
  room,
  myNicknameId,
  myNickname,
  restaurants,
  onLeave,
  onTransferHost,
  onToggleReady,
  onPickRestaurant,
  onSelectCandidateAsMyPick,
  onRemoveCandidate,
  onDirectAddCandidate,
  onSendMessage,
  onStartGame,
  messages,
}: BattleRoomViewProps) {
  const [chatInput, setChatInput] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // 나가기 확인 모달 상태
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);

  // 방장 수동 위임 확인 모달 상태
  const [targetHostPlayer, setTargetHostPlayer] = useState<BattlePlayer | null>(null);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 방장 여부 판정 (ID 일치 또는 닉네임 일치)
  const me = room.players.find(
    (p) => p.nicknameId === myNicknameId || p.nickname === myNickname
  );
  const isHost = Boolean(
    me?.isHost ||
      room.hostNicknameId === myNicknameId ||
      (room.hostNickname && room.hostNickname === myNickname)
  );

  const otherPlayers = room.players.filter(
    (p) => p.nicknameId !== room.hostNicknameId && p.nickname !== room.hostNickname
  );
  const allOtherReady = otherPlayers.length === 0 || otherPlayers.every((p) => p.isReady);
  const canStart = isHost && room.candidates.length >= 2 && allOtherReady;

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendMessage(chatInput);
    setChatInput("");
  };

  const handleStart = async () => {
    if (!canStart || isStarting) return;
    setStartError(null);
    setIsStarting(true);
    const res = await onStartGame();
    setIsStarting(false);
    if (!res.success && res.error) {
      setStartError(res.error);
    }
  };

  const confirmLeave = () => {
    setIsLeaveModalOpen(false);
    onLeave();
  };

  const confirmTransferHost = () => {
    if (targetHostPlayer && onTransferHost) {
      onTransferHost(targetHostPlayer.nicknameId);
      setTargetHostPlayer(null);
    }
  };

  // 슬롯 생성 (최대 인원수만큼 고정 슬롯 렌더링)
  const slots: (BattlePlayer | null)[] = Array.from({ length: room.maxPlayers }, (_, i) => {
    return room.players.find((p) => p.slotIndex === i) || null;
  });

  // 인원수에 따른 반응형 그리드 열 계산 (6인은 3열, 4인은 2열 또는 4열, 8인은 4열)
  const getGridColsClass = (max: number) => {
    if (max <= 4) return "grid-cols-2";
    if (max <= 6) return "grid-cols-3";
    return "grid-cols-3 sm:grid-cols-4";
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case "speed-vote":
        return "스피드 투표";
      case "worldcup":
        return "메뉴 월드컵";
      case "roulette":
        return "운명의 룰렛";
      default:
        return mode;
    }
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* 상단 룸 헤더 바 */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs font-semibold text-neutral-400">
            #{room.id}
          </span>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight truncate max-w-[280px] sm:max-w-none">
            {room.title}
          </h2>
          <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-400 border border-blue-500/20">
            {getModeLabel(room.gameMode)}
          </span>
          <span className="text-xs text-neutral-400 font-medium">
            인원 {room.players.length}/{room.maxPlayers}
          </span>
        </div>

        <button
          onClick={() => setIsLeaveModalOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-700 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          대기실 나가기
        </button>
      </div>

      {/* 중앙 메인 바디 */}
      <div className="grid flex-1 grid-cols-1 md:grid-cols-12 gap-3.5 p-4 overflow-hidden min-h-0">
        {/* 좌측: 플레이어 슬롯(대폭 확대) + 후보 메뉴(콤팩트 축소) (7 cols) */}
        <div className="flex flex-col md:col-span-7 gap-3 overflow-hidden min-h-0">
          {/* 1. 참가자 슬롯 영역 (flex-1로 메인 공간 차지 및 넉넉한 슬롯 디자인) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-xs sm:text-sm font-bold text-neutral-200">
                참가자 슬롯 ({room.players.length}/{room.maxPlayers})
              </span>
              <span className="text-xs text-neutral-400 font-medium">
                {isHost
                  ? room.candidates.length < 2
                    ? "후보를 2개 이상 등록해주세요."
                    : "준비 완료 시 시작 가능"
                  : "식당 픽 후 준비완료(READY)"}
              </span>
            </div>

            <div className={`grid ${getGridColsClass(room.maxPlayers)} gap-3 flex-1 auto-rows-fr`}>
              {slots.map((player, idx) => {
                if (player) {
                  const isPlayerMe =
                    player.nicknameId === myNicknameId || player.nickname === myNickname;
                  const isPlayerHost = Boolean(
                    player.isHost ||
                      room.hostNicknameId === player.nicknameId ||
                      room.hostNickname === player.nickname
                  );

                  return (
                    <div
                      key={player.nicknameId || idx}
                      className={`relative flex flex-col justify-between rounded-2xl border p-3.5 transition ${
                        player.isReady
                          ? "border-emerald-500/70 bg-emerald-950/20 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                          : "border-neutral-800 bg-neutral-900/80"
                      } ${isPlayerMe ? "ring-2 ring-blue-500/70" : ""}`}
                    >
                      {/* 상단: 슬롯 번호 & 상태 뱃지 */}
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-neutral-400">P{idx + 1}</span>
                        <div className="flex items-center gap-1">
                          {isPlayerHost && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-400 border border-amber-500/30">
                              HOST
                            </span>
                          )}
                          {player.isReady ? (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-400 border border-emerald-500/30">
                              READY
                            </span>
                          ) : (
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
                              선택 중
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 중단: 닉네임 (한 글자 아바타 제거, 닉네임 전체 표시) */}
                      <div className="my-3 flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm sm:text-base text-white tracking-tight break-keep flex items-center gap-1">
                            <span className="truncate">{player.nickname}</span>
                            {isPlayerMe && (
                              <span className="shrink-0 text-[11px] font-extrabold text-blue-400">
                                (나)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 하단: 픽한 메뉴 카드 */}
                      <div className="rounded-xl border border-neutral-800/90 bg-neutral-950/80 p-2 text-xs">
                        {player.pickedRestaurant ? (
                          <div className="min-w-0">
                            <div className="truncate font-bold text-blue-300 text-xs sm:text-sm">
                              {player.pickedRestaurant.name}
                            </div>
                            <div className="truncate text-[10px] text-neutral-400 mt-0.5">
                              {player.pickedRestaurant.category || "식당"}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center text-xs text-neutral-400 italic py-1">
                            메뉴 선택 중
                          </div>
                        )}
                      </div>

                      {/* 방장 위임 버튼 */}
                      {isHost && !isPlayerMe && onTransferHost && (
                        <button
                          onClick={() => setTargetHostPlayer(player)}
                          className="mt-2 w-full rounded-lg border border-neutral-700/60 bg-neutral-800/60 py-1 text-[10px] font-semibold text-neutral-300 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-300 transition"
                        >
                          방장 위임
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={`empty-${idx}`}
                    className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800/70 bg-neutral-900/30 p-4 text-center min-h-[120px]"
                  >
                    <span className="font-mono text-[11px] text-neutral-400 font-bold">P{idx + 1}</span>
                    <span className="text-xs sm:text-sm font-semibold text-neutral-400 mt-1.5">빈 자리</span>
                    <span className="text-[10px] text-neutral-400 mt-0.5">대기 중</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. 후보 메뉴 영역 (콤팩트 축소) */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-neutral-300">
                  후보 메뉴 ({room.candidates.length}개)
                </span>
                <span className="text-[11px] text-neutral-400">
                  클릭 시 내 대표 픽 지정
                </span>
              </div>
              <button
                onClick={() => setIsPickerOpen(true)}
                className="text-xs font-bold text-blue-400 hover:text-blue-300 underline underline-offset-2"
              >
                + 후보 추가
              </button>
            </div>

            <div className="overflow-y-auto max-h-[70px] pr-1">
              {room.candidates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {room.candidates.map((cand) => {
                    const isMyPick = me?.pickedRestaurant?.name === cand.name;
                    const canDelete =
                      isHost || cand.addedByNickname === myNickname;

                    return (
                      <div
                        key={cand.id}
                        className={`group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
                          isMyPick
                            ? "border-blue-500 bg-blue-950/70 text-blue-200 font-bold"
                            : "border-neutral-700 bg-neutral-800/90 text-neutral-200 hover:border-neutral-600"
                        }`}
                      >
                        <button
                          onClick={() => onSelectCandidateAsMyPick(cand)}
                          className="flex items-center gap-1 text-left"
                          title="클릭 시 내 대표 픽으로 설정"
                        >
                          <span className="font-semibold text-white">{cand.name}</span>
                          {cand.category && (
                            <span className="text-[10px] text-neutral-400">({cand.category})</span>
                          )}
                          {isMyPick && (
                            <span className="rounded bg-blue-500 px-1 py-0.2 text-[9px] font-bold text-white">
                              내 픽
                            </span>
                          )}
                        </button>
                        {canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveCandidate(cand.id);
                            }}
                            className="text-neutral-400 hover:text-rose-400 p-0.5 ml-0.5"
                            title="후보 삭제"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-2 text-center text-xs text-neutral-400">
                  등록된 후보가 없습니다. 최소 2개의 후보를 등록해주세요.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 우측: 실시간 대화창 (5 cols) */}
        <div className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 md:col-span-5 overflow-hidden h-full min-h-0">
          <div className="border-b border-neutral-800 px-4 py-2.5 text-xs sm:text-sm font-bold text-neutral-300 flex items-center justify-between shrink-0">
            <span>실시간 대화</span>
            <span className="text-[10px] font-mono text-neutral-400">LIVE CHAT</span>
          </div>

          {/* 채팅 메시지 목록 */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2 text-xs sm:text-sm min-h-0">
            {messages.map((msg) => {
              if (msg.isSystem) {
                return (
                  <div key={msg.id} className="py-0.5 text-center text-[11px] text-neutral-400 italic">
                    [알림] {msg.content}
                  </div>
                );
              }
              const isMine = msg.senderNickname === myNickname;
              return (
                <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <span className="text-[10px] text-neutral-400 mb-0.5 font-medium">{msg.senderNickname}</span>
                  <div
                    className={`rounded-2xl px-3 py-1.5 max-w-[85%] break-words text-xs sm:text-sm font-medium ${
                      isMine ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-200"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={chatBottomRef} />
          </div>

          {/* 채팅 입력폼 */}
          <form onSubmit={handleSendChat} className="border-t border-neutral-800 p-2.5 flex gap-2 shrink-0 bg-neutral-950">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="대화를 입력하세요..."
              className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs sm:text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs sm:text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              전송
            </button>
          </form>
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="border-t border-neutral-800 bg-neutral-900 px-5 py-3 shrink-0">
        {startError && (
          <div className="mb-2 text-center text-xs font-semibold text-rose-400">{startError}</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPickerOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-xs sm:text-sm font-bold text-neutral-200 transition hover:bg-neutral-700 hover:text-white"
            >
              <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              추천 식당 고르기
            </button>

            {!isHost && (
              <button
                onClick={onToggleReady}
                className={`rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold transition ${
                  me?.isReady
                    ? "border border-emerald-500 bg-emerald-600 text-white shadow-lg shadow-emerald-900/30"
                    : "border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {me?.isReady ? "준비 완료 (READY)" : "준비하기 (READY)"}
              </button>
            )}
          </div>

          {isHost ? (
            <button
              onClick={handleStart}
              disabled={!canStart || isStarting}
              className={`rounded-xl px-6 py-2.5 text-sm font-black tracking-wide transition ${
                canStart
                  ? "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/40 cursor-pointer"
                  : "bg-neutral-800 text-neutral-400 cursor-not-allowed border border-neutral-700/50"
              }`}
            >
              {isStarting ? "시작 중..." : "GAME START"}
            </button>
          ) : (
            <div className="text-xs text-neutral-400 font-medium">
              방장이 게임을 시작할 때까지 대기해주세요.
            </div>
          )}
        </div>
      </div>

      {/* 1. 나가기 확인 모달 */}
      {isLeaveModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-neutral-100 shadow-2xl">
            <h3 className="font-bold text-white text-sm">대기실 나가기</h3>
            <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
              {isHost
                ? otherPlayers.length > 0
                  ? "방장 권한이 다음 참가자에게 자동으로 위임됩니다. 대기실을 나가시겠습니까?"
                  : "방에 혼자 남아있어 방이 삭제(종료)됩니다. 나가시겠습니까?"
                : "대기실에서 나가시겠습니까?"}
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsLeaveModalOpen(false)}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmLeave}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 방장 위임 확인 모달 */}
      {targetHostPlayer && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-neutral-100 shadow-2xl">
            <h3 className="font-bold text-white text-sm">방장 권한 위임</h3>
            <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
              &apos;{targetHostPlayer.nickname}&apos; 님에게 방장 권한을 넘기시겠습니까?
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTargetHostPlayer(null)}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmTransferHost}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                위임하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. 식당 선택 모달 */}
      <BattleRestaurantPickerModal
        open={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        restaurants={restaurants}
        onPick={onPickRestaurant}
        onDirectAdd={onDirectAddCandidate}
      />
    </div>
  );
}
