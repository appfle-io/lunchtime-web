"use client";

import { useState } from "react";
import type { BattleGameMode, BattleRoomSummary } from "@/types/battle";
import type { RestaurantSummary } from "@/types";
import { useBattleRoom } from "@/hooks/useBattleRoom";
import BattleRoomView from "./BattleRoomView";
import BattleGameView from "./BattleGameView";
import BattleResultView from "./BattleResultView";

interface BattleLobbyModalProps {
  open: boolean;
  onClose: () => void;
  companyCode: string;
  myNicknameId: string;
  myNickname: string;
  restaurants: RestaurantSummary[];
  onNotify?: (message: string) => void;
}

export default function BattleLobbyModal({
  open,
  onClose,
  companyCode,
  myNicknameId,
  myNickname,
  restaurants,
  onNotify,
}: BattleLobbyModalProps) {
  const {
    isConnected,
    rooms,
    currentRoom,
    messages,
    voteState,
    worldcupMatch,
    isLoadingRooms,
    refreshRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    transferHost,
    deleteRoomFromLobby,
    toggleReady,
    pickRestaurant,
    setMyPickedCandidate,
    removeCandidate,
    addCandidate,
    sendChatMessage,
    startGame,
    castVote,
    returnToWaitingRoom,
  } = useBattleRoom({
    companyCode,
    myNicknameId,
    myNickname,
    onNotify,
  });

  // 방 만들기 모달 상태
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newMaxPlayers, setNewMaxPlayers] = useState(6);
  const [newGameMode, setNewGameMode] = useState<BattleGameMode>("speed-vote");
  const [isCreating, setIsCreating] = useState(false);

  // 비번 입력 입장 모달 상태
  const [selectedRoomToJoin, setSelectedRoomToJoin] = useState<BattleRoomSummary | null>(null);
  const [joinPasswordInput, setJoinPasswordInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  // 방 삭제 확인 모달 상태
  const [roomToDelete, setRoomToDelete] = useState<BattleRoomSummary | null>(null);

  if (!open) return null;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setIsCreating(true);
    const res = await createRoom(newTitle.trim(), newPassword, newMaxPlayers, newGameMode);
    setIsCreating(false);
    if (res.success) {
      setIsCreateModalOpen(false);
      setNewTitle("");
      setNewPassword("");
    } else if (res.error && onNotify) {
      onNotify(res.error);
    }
  };

  const handleJoinClick = (room: BattleRoomSummary) => {
    if (room.hasPassword) {
      setSelectedRoomToJoin(room);
      setJoinPasswordInput("");
      setJoinError(null);
    } else {
      joinRoom(room.id).then((res) => {
        if (!res.success && res.error && onNotify) {
          onNotify(res.error);
        }
      });
    }
  };

  const handlePasswordJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoomToJoin) return;
    const res = await joinRoom(selectedRoomToJoin.id, joinPasswordInput);
    if (res.success) {
      setSelectedRoomToJoin(null);
      setJoinPasswordInput("");
    } else {
      setJoinError(res.error || "비밀번호가 올바르지 않습니다.");
    }
  };

  const handleDeleteRoom = async (forceDeleteAll: boolean) => {
    if (!roomToDelete) return;
    await deleteRoomFromLobby(roomToDelete.id, forceDeleteAll);
    setRoomToDelete(null);
  };

  const getModeBadge = (mode: string) => {
    switch (mode) {
      case "speed-vote":
        return <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/20">스피드 투표</span>;
      case "worldcup":
        return <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-400 border border-purple-500/20">메뉴 월드컵</span>;
      case "roulette":
        return <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">운명의 룰렛</span>;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4 backdrop-blur-md">
      {/* 넉넉하고 시원한 게이밍 모달 컨테이너 (max-w-4xl, h-82vh) */}
      <div className="flex h-[82vh] min-h-[560px] max-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
        {/* 방 안 / 게임 / 결과 화면 분기 */}
        {currentRoom ? (
          currentRoom.status === "waiting" ? (
            <BattleRoomView
              room={currentRoom}
              myNicknameId={myNicknameId}
              myNickname={myNickname}
              restaurants={restaurants}
              onLeave={leaveRoom}
              onTransferHost={transferHost}
              onToggleReady={toggleReady}
              onPickRestaurant={pickRestaurant}
              onSelectCandidateAsMyPick={setMyPickedCandidate}
              onRemoveCandidate={removeCandidate}
              onDirectAddCandidate={addCandidate}
              onSendMessage={sendChatMessage}
              onStartGame={startGame}
              messages={messages}
            />
          ) : currentRoom.status === "in-game" ? (
            <BattleGameView
              room={currentRoom}
              myNicknameId={myNicknameId}
              voteState={voteState}
              worldcupMatch={worldcupMatch}
              onCastVote={castVote}
            />
          ) : (
            currentRoom.result && (
              <BattleResultView
                room={currentRoom}
                result={currentRoom.result}
                restaurants={restaurants}
                companyCode={companyCode}
                myNicknameId={myNicknameId}
                myNickname={myNickname}
                onBackToLobby={leaveRoom}
                onReturnToWaitingRoom={returnToWaitingRoom}
                onNotify={onNotify}
              />
            )
          )
        ) : (
          /* 로비 화면 (방 목록 및 방 만들기) */
          <div className="flex h-full flex-col overflow-hidden">
            {/* 로비 상단 헤더 */}
            <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-4 py-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-tight">대기실</h2>
                  <div className="flex items-center gap-1 rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">
                    <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400 animate-ping"}`} />
                    <span>{isConnected ? "실시간 연결됨" : "연결 중..."}</span>
                  </div>
                </div>
                <p className="text-[11px] text-neutral-400">
                  방을 만들어 동료들과 함께 메뉴를 고르고 게임으로 결정해보세요.
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={refreshRooms}
                  disabled={isLoadingRooms}
                  className="rounded-lg border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-300 transition hover:bg-neutral-700 hover:text-white"
                  title="방 목록 새로고침"
                >
                  <svg className={`h-3.5 w-3.5 ${isLoadingRooms ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-500 shadow-md"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  방 만들기
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 방 목록 컨텐츠 */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {rooms.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {rooms.map((room) => {
                    const isFull = room.playerCount >= room.maxPlayers;
                    const isInGame = room.status !== "waiting";
                    const isMyRoom = room.hostNickname === myNickname;

                    return (
                      <div
                        key={room.id}
                        className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 transition hover:border-neutral-700 hover:bg-neutral-900 shadow-sm"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[9px] text-neutral-400">#{room.id}</span>
                            <div className="flex items-center gap-1">
                              {getModeBadge(room.gameMode)}
                              {room.hasPassword && (
                                <span className="rounded bg-neutral-800 px-1 py-0.2 text-[9px] text-neutral-400 border border-neutral-700">
                                  비번
                                </span>
                              )}
                            </div>
                          </div>
                          <h3 className="mt-1.5 font-bold text-white text-sm tracking-tight truncate">
                            {room.title}
                          </h3>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-400">
                            <span>방장: {room.hostNickname}</span>
                            <span className="font-mono font-medium text-neutral-300">
                              {room.playerCount} / {room.maxPlayers}명
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-neutral-800/80 pt-2">
                          <div className="flex items-center gap-1.5">
                            {isInGame ? (
                              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400 border border-amber-500/20">
                                게임 진행 중
                              </span>
                            ) : isFull ? (
                              <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-400 border border-rose-500/20">
                                정원 마감
                              </span>
                            ) : (
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 border border-emerald-500/20">
                                입장 가능
                              </span>
                            )}

                            {/* 내가 만든 방 삭제 버튼 */}
                            {isMyRoom && (
                              <button
                                onClick={() => setRoomToDelete(room)}
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-rose-400 hover:bg-rose-950/50 hover:text-rose-300 transition border border-rose-500/20"
                                title="방 삭제 또는 나가기"
                              >
                                방 삭제
                              </button>
                            )}
                          </div>

                          <button
                            onClick={() => handleJoinClick(room)}
                            disabled={isFull || isInGame}
                            className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                              isFull || isInGame
                                ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                                : "bg-neutral-800 text-neutral-200 hover:bg-blue-600 hover:text-white"
                            }`}
                          >
                            입장하기
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center py-10">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 border border-neutral-800 text-neutral-500 mb-2">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="font-bold text-white text-sm">개설된 방이 없습니다</h3>
                  <p className="mt-1 text-xs text-neutral-400">
                    첫 번째 방을 만들고 동료들을 초대해 보세요.
                  </p>
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="mt-3 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-blue-500 shadow-md"
                  >
                    방 만들기
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 1. 방 만들기 팝업 모달 */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-neutral-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-sm font-bold text-white">새 방 개설하기</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-neutral-400 hover:text-white text-xs"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-3 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-neutral-300">
                  방 제목
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="예: 오늘 영등포시장역 국밥 드실 분"
                  required
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-neutral-300">
                  게임 모드
                </label>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setNewGameMode("speed-vote")}
                    className={`rounded-lg border p-2 text-center transition ${
                      newGameMode === "speed-vote"
                        ? "border-blue-500 bg-blue-950/40 text-blue-300"
                        : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="text-xs font-bold">스피드 투표</div>
                    <div className="text-[9px] text-neutral-400 mt-0.5">15초 다수결</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewGameMode("worldcup")}
                    className={`rounded-lg border p-2 text-center transition ${
                      newGameMode === "worldcup"
                        ? "border-purple-500 bg-purple-950/40 text-purple-300"
                        : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="text-xs font-bold">메뉴 월드컵</div>
                    <div className="text-[9px] text-neutral-400 mt-0.5">1:1 토너먼트</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewGameMode("roulette")}
                    className={`rounded-lg border p-2 text-center transition ${
                      newGameMode === "roulette"
                        ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
                        : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <div className="text-xs font-bold">운명의 룰렛</div>
                    <div className="text-[9px] text-neutral-400 mt-0.5">랜덤 추첨</div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-300">
                    최대 인원
                  </label>
                  <select
                    value={newMaxPlayers}
                    onChange={(e) => setNewMaxPlayers(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value={2}>2명</option>
                    <option value={4}>4명</option>
                    <option value={6}>6명</option>
                    <option value={8}>8명</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-neutral-300">
                    비밀번호 (선택)
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="미입력시 공개방"
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2 border-t border-neutral-800 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newTitle.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-blue-500 disabled:opacity-40"
                >
                  {isCreating ? "개설 중..." : "방 개설"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. 비밀번호 입력 입장 팝업 */}
      {selectedRoomToJoin && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-neutral-100 shadow-2xl">
            <h3 className="text-sm font-bold text-white">비밀번호 확인</h3>
            <p className="mt-1 text-xs text-neutral-400 truncate">
              &apos;{selectedRoomToJoin.title}&apos; 입장
            </p>

            <form onSubmit={handlePasswordJoinSubmit} className="mt-3 space-y-3">
              <input
                type="password"
                value={joinPasswordInput}
                onChange={(e) => setJoinPasswordInput(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                autoFocus
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
              />

              {joinError && (
                <div className="text-[11px] font-medium text-rose-400">{joinError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRoomToJoin(null)}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
                >
                  입장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. 방 삭제 확인 팝업 (다른 사람 있으면 위임 or 삭제) */}
      {roomToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-neutral-100 shadow-2xl">
            <h3 className="text-sm font-bold text-white">방 삭제 / 나가기</h3>
            <p className="mt-2 text-xs text-neutral-300 leading-relaxed">
              {roomToDelete.playerCount > 1
                ? `방에 다른 참여자(${roomToDelete.playerCount - 1}명)가 있습니다. 권한을 넘기고 나만 나가시겠습니까, 아니면 방을 완전히 삭제하시겠습니까?`
                : "개설한 방을 삭제하시겠습니까?"}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {roomToDelete.playerCount > 1 && (
                <button
                  type="button"
                  onClick={() => handleDeleteRoom(false)}
                  className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
                >
                  방장 권한 넘기고 나만 나가기
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDeleteRoom(true)}
                className="w-full rounded-lg bg-rose-600 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
              >
                방 완전히 삭제하기
              </button>
              <button
                type="button"
                onClick={() => setRoomToDelete(null)}
                className="w-full rounded-lg border border-neutral-700 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
