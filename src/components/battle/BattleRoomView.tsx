"use client";

import { useState, useRef, useEffect } from "react";
import type { BattleCandidate, BattleChatMessage, BattleGameMode, BattlePlayer, BattleRoomDetail } from "@/types/battle";
import type { RestaurantSummary } from "@/types";
import BattleRestaurantPickerModal from "./BattleRestaurantPickerModal";
import { useModalBehavior } from "@/hooks/useModalBehavior";

interface BattleRoomViewProps {
  room: BattleRoomDetail;
  myNicknameId: string;
  myNickname: string;
  restaurants: RestaurantSummary[];
  onLeave: () => void;
  onTransferHost?: (targetNicknameId: string) => void;
  onChangeGameMode?: (mode: BattleGameMode) => void;
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
  onChangeGameMode,
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
  useModalBehavior(isLeaveModalOpen, () => setIsLeaveModalOpen(false));
  useModalBehavior(targetHostPlayer !== null, () => setTargetHostPlayer(null));

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
    <div className="flex h-full flex-col bg-surface text-ink overflow-hidden">
      {/* 상단 룸 헤더 바 */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/5 bg-surface px-4 sm:px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-xs font-semibold text-ink-soft">
            #{room.id}
          </span>
          <h2 className="text-base sm:text-lg font-bold text-ink tracking-tight truncate max-w-[200px] sm:max-w-[320px]">
            {room.title}
          </h2>

          {/* 게임 모드 뱃지 또는 방장 전용 모드 변경 드롭다운 */}
          {isHost && onChangeGameMode ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1">
              <span className="text-[11px] font-semibold text-primary">게임:</span>
              <select
                value={room.gameMode}
                onChange={(e) => onChangeGameMode(e.target.value as BattleGameMode)}
                className="bg-transparent text-xs font-bold text-primary focus:outline-none cursor-pointer"
                title="게임 모드 변경"
              >
                <option value="speed-vote">스피드 투표 (60초)</option>
                <option value="worldcup">메뉴 월드컵</option>
                <option value="roulette">운명의 룰렛</option>
              </select>
            </div>
          ) : (
            <span className="rounded-md bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
              {getModeLabel(room.gameMode)}
            </span>
          )}

          <span className="text-xs text-ink-soft font-medium">
            인원 {room.players.length}/{room.maxPlayers}명
          </span>
        </div>

        <button
          onClick={() => setIsLeaveModalOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-black/10 bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-surface-muted hover:text-ink shrink-0"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          나가기
        </button>
      </div>

      {/* 중앙 메인 바디 */}
      <div className="grid flex-1 grid-cols-1 md:grid-cols-12 gap-3.5 p-4 overflow-hidden min-h-0 bg-surface-muted/30">
        {/* 좌측: 플레이어 슬롯 + 후보 메뉴 (7 cols) */}
        <div className="flex flex-col md:col-span-7 gap-3 overflow-hidden min-h-0">
          {/* 1. 참가자 슬롯 영역 */}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-xs sm:text-sm font-bold text-ink">
                참가자 ({room.players.length}/{room.maxPlayers}명)
              </span>
              <span className="text-xs text-ink-soft font-medium">
                {isHost
                  ? room.candidates.length < 2
                    ? "후보 메뉴를 2개 이상 등록해 주세요."
                    : "모두 준비되면 시작할 수 있습니다."
                  : "메뉴를 고르고 준비를 완료해 주세요."}
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
                      className={`relative flex flex-col justify-between rounded-2xl border p-3.5 transition shadow-xs ${
                        player.isReady
                          ? "border-emerald-400 bg-emerald-50/40"
                          : "border-black/5 bg-surface"
                      } ${isPlayerMe ? "ring-2 ring-primary/60" : ""}`}
                    >
                      {/* 상단: 번호 & 상태 뱃지 */}
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-ink-soft">{idx + 1}번 자리</span>
                        <div className="flex items-center gap-1">
                          {isPlayerHost && (
                            <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                              방장
                            </span>
                          )}
                          {player.isReady ? (
                            <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              준비 완료
                            </span>
                          ) : (
                            <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-soft border border-black/5">
                              선택 중
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 중단: 닉네임 */}
                      <div className="my-2.5 flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm sm:text-base text-ink tracking-tight truncate flex items-center gap-1">
                            <span className="truncate">{player.nickname}</span>
                            {isPlayerMe && (
                              <span className="shrink-0 text-xs font-bold text-primary">
                                (나)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 하단: 픽한 메뉴 카드 */}
                      <div className="rounded-xl border border-black/5 bg-surface-muted/70 p-2.5 text-xs">
                        {player.pickedRestaurant ? (
                          <div className="min-w-0">
                            <div className="truncate font-bold text-ink text-xs sm:text-sm">
                              {player.pickedRestaurant.name}
                            </div>
                            <div className="truncate text-[11px] text-ink-soft mt-0.5">
                              {player.pickedRestaurant.category || "식당"}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center text-xs text-ink-soft italic py-1">
                            메뉴 선택 중
                          </div>
                        )}
                      </div>

                      {/* 방장 위임 버튼 */}
                      {isHost && !isPlayerMe && onTransferHost && (
                        <button
                          onClick={() => setTargetHostPlayer(player)}
                          className="mt-2 w-full rounded-lg border border-black/10 bg-surface py-1 text-[10px] font-semibold text-ink-soft hover:border-primary hover:text-primary transition"
                        >
                          방장 권한 위임
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={`empty-${idx}`}
                    className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 bg-surface-muted/40 p-4 text-center min-h-[120px]"
                  >
                    <span className="font-mono text-[11px] text-ink-soft font-bold">{idx + 1}번 자리</span>
                    <span className="text-xs sm:text-sm font-semibold text-ink-soft mt-1">빈 자리</span>
                    <span className="text-[10px] text-ink-soft/70 mt-0.5">대기 중</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. 후보 메뉴 영역 */}
          <div className="rounded-2xl border border-black/5 bg-surface p-3 shrink-0 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-ink">
                  후보 메뉴 ({room.candidates.length}개)
                </span>
                <span className="text-[11px] text-ink-soft">
                  클릭 시 내 대표 픽으로 설정
                </span>
              </div>
              <button
                onClick={() => setIsPickerOpen(true)}
                className="text-xs font-bold text-primary hover:text-primary-dark underline underline-offset-2"
              >
                + 후보 추가
              </button>
            </div>

            <div className="overflow-y-auto max-h-[75px] pr-1">
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
                            ? "border-primary bg-primary-light text-primary-dark font-bold"
                            : "border-black/10 bg-surface-muted text-ink hover:border-black/20"
                        }`}
                      >
                        <button
                          onClick={() => onSelectCandidateAsMyPick(cand)}
                          className="flex items-center gap-1 text-left"
                          title="클릭 시 내 대표 픽으로 설정"
                        >
                          <span className="font-semibold">{cand.name}</span>
                          {cand.category && (
                            <span className="text-[10px] text-ink-soft">({cand.category})</span>
                          )}
                          {isMyPick && (
                            <span className="rounded bg-primary px-1 py-0.2 text-[9px] font-bold text-white">
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
                            className="text-ink-soft hover:text-rose-600 p-0.5 ml-0.5"
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
                <div className="py-2 text-center text-xs text-ink-soft">
                  등록된 후보가 없습니다. 최소 2개의 후보를 등록해 주세요.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 우측: 실시간 대화창 (5 cols) */}
        <div className="flex flex-col rounded-2xl border border-black/5 bg-surface md:col-span-5 overflow-hidden h-full min-h-0 shadow-xs">
          <div className="border-b border-black/5 bg-surface px-4 py-2.5 text-xs sm:text-sm font-bold text-ink flex items-center justify-between shrink-0">
            <span>실시간 대화</span>
            <span className="text-[10px] font-medium text-ink-soft">실시간 참여 중</span>
          </div>

          {/* 채팅 메시지 목록 */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 text-xs sm:text-sm min-h-0 bg-surface-muted/20">
            {messages.map((msg) => {
              if (msg.isSystem) {
                return (
                  <div key={msg.id} className="py-0.5 text-center text-[11px] text-ink-soft italic">
                    {msg.content}
                  </div>
                );
              }
              const isMine = msg.senderNickname === myNickname;
              return (
                <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <span className="text-[10px] text-ink-soft mb-0.5 font-medium">{msg.senderNickname}</span>
                  <div
                    className={`rounded-2xl px-3.5 py-2 max-w-[85%] break-words text-xs sm:text-sm font-medium shadow-xs ${
                      isMine
                        ? "bg-primary text-white rounded-tr-xs"
                        : "bg-surface border border-black/5 text-ink rounded-tl-xs"
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
          <form onSubmit={handleSendChat} className="border-t border-black/5 p-2.5 flex gap-2 shrink-0 bg-surface">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="메시지를 입력하세요..."
              className="flex-1 rounded-xl border border-black/10 bg-surface-muted/50 px-3 py-2 text-xs sm:text-sm text-ink placeholder-ink-soft focus:border-primary focus:bg-surface focus:outline-none"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="rounded-xl bg-primary px-4 py-2 text-xs sm:text-sm font-bold text-white transition hover:bg-primary-dark disabled:opacity-40 shadow-xs"
            >
              전송
            </button>
          </form>
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="border-t border-black/5 bg-surface px-5 py-3.5 shrink-0">
        {startError && (
          <div className="mb-2 text-center text-xs font-semibold text-rose-500">{startError}</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPickerOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-black/10 bg-surface px-4 py-2.5 text-xs sm:text-sm font-bold text-ink transition hover:bg-surface-muted"
            >
              <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              식당 후보 고르기
            </button>

            {!isHost && (
              <button
                onClick={onToggleReady}
                className={`rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold transition ${
                  me?.isReady
                    ? "border border-emerald-500 bg-emerald-600 text-white shadow-xs"
                    : "border border-black/10 bg-surface text-ink hover:bg-surface-muted"
                }`}
              >
                {me?.isReady ? "준비 완료" : "준비하기"}
              </button>
            )}
          </div>

          {isHost ? (
            <button
              onClick={handleStart}
              disabled={!canStart || isStarting}
              className={`rounded-xl px-6 py-2.5 text-sm font-black tracking-wide transition ${
                canStart
                  ? "bg-primary text-white hover:bg-primary-dark shadow-sm cursor-pointer active:scale-[0.98]"
                  : "bg-surface-muted text-ink-soft cursor-not-allowed border border-black/5"
              }`}
            >
              {isStarting ? "시작 중..." : "투표/게임 시작"}
            </button>
          ) : (
            <div className="text-xs text-ink-soft font-medium">
              방장이 게임을 시작할 때까지 잠시 기다려 주세요.
            </div>
          )}
        </div>
      </div>

      {/* 1. 나가기 확인 모달 */}
      {isLeaveModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xs rounded-2xl border border-black/10 bg-surface p-5 text-ink shadow-soft">
            <h3 className="font-bold text-ink text-sm">대기실 나가기</h3>
            <p className="text-xs text-ink-soft mt-2 leading-relaxed">
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
                className="rounded-xl border border-black/10 px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmLeave}
                className="rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 방장 위임 확인 모달 */}
      {targetHostPlayer && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xs rounded-2xl border border-black/10 bg-surface p-5 text-ink shadow-soft">
            <h3 className="font-bold text-ink text-sm">방장 권한 위임</h3>
            <p className="text-xs text-ink-soft mt-2 leading-relaxed">
              &apos;{targetHostPlayer.nickname}&apos; 님에게 방장 권한을 넘기시겠습니까?
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTargetHostPlayer(null)}
                className="rounded-xl border border-black/10 px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmTransferHost}
                className="rounded-xl bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
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
