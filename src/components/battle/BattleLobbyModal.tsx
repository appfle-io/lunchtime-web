"use client";

import { useState } from "react";
import type { BattleGameMode, BattleRoomSummary } from "@/types/battle";
import type { RestaurantSummary } from "@/types";
import { useBattleRoom } from "@/hooks/useBattleRoom";
import BattleRoomView from "./BattleRoomView";
import BattleGameView from "./BattleGameView";
import BattleResultView from "./BattleResultView";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import Icon from "../ui/Icon";

interface BattleLobbyModalProps {
  open: boolean;
  onClose: () => void;
  companyCode: string;
  myNicknameId: string;
  myNickname: string;
  restaurants: RestaurantSummary[];
  onNotify?: (message: string) => void;
}

// 모달이 닫혀 있을 때는 내부 컴포넌트(= useBattleRoom 훅)를 아예 마운트하지 않는다.
// 예전엔 훅이 모달 열림 여부와 무관하게 항상 돌아서, 로그인한 모든 사용자가 하루 종일 RTDB에
// 연결된 채 전체 배틀방 데이터를 구독하고 있었다(동시 접속 수/다운로드 비용 누수).
export default function BattleLobbyModal(props: BattleLobbyModalProps) {
  if (!props.open) return null;
  return <BattleLobbyContent {...props} />;
}

function BattleLobbyContent({
  onClose,
  companyCode,
  myNicknameId,
  myNickname,
  restaurants,
  onNotify,
}: BattleLobbyModalProps) {
  const {
    isConnected,
    authError,
    retryAuth,
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
    changeGameMode,
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

  // Esc: 로비에서는 모달 닫기(방 안에서는 닫기 버튼이 없으므로 Esc도 막는다), 팝업은 팝업만 닫기.
  useModalBehavior(!currentRoom, onClose);
  useModalBehavior(isCreateModalOpen, () => {
    if (!isCreating) setIsCreateModalOpen(false);
  });
  useModalBehavior(selectedRoomToJoin !== null, () => setSelectedRoomToJoin(null));
  useModalBehavior(roomToDelete !== null, () => setRoomToDelete(null));

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
        return (
          <span className="rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/20">
            스피드 투표
          </span>
        );
      case "worldcup":
        return (
          <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
            메뉴 월드컵
          </span>
        );
      case "roulette":
        return (
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            운명의 룰렛
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4 backdrop-blur-sm">
      {/* 메인 모달 컨테이너 */}
      <div className="flex h-[82vh] min-h-[560px] max-h-[740px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-black/10 bg-surface text-ink shadow-soft">
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
              onChangeGameMode={changeGameMode}
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
          <div className="flex h-full flex-col overflow-hidden bg-surface">
            {/* 로비 상단 헤더: 모바일에서 버튼 글자가 세로로 꺾이지 않게 제목 줄과 동작 줄을 나눈다 */}
            <div className="shrink-0 border-b border-black/5 bg-surface px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold tracking-tight text-ink">같이 밥 먹을 사람 찾기</h2>
                  <p className="mt-0.5 hidden text-xs text-ink-soft sm:block">
                    동료들과 실시간으로 대화하고 투표로 점심 메뉴를 정해 보세요.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="-mr-1 shrink-0 rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink"
                  aria-label="닫기"
                >
                  <Icon name="close" className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-soft">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      authError ? "bg-danger" : isConnected ? "bg-success" : "animate-pulse bg-warning"
                    }`}
                  />
                  <span>{authError ? "연결 안 됨" : isConnected ? "실시간 연결" : "연결 중"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={refreshRooms}
                    disabled={isLoadingRooms || Boolean(authError)}
                    className="rounded-xl border border-black/10 bg-surface p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink disabled:opacity-40"
                    aria-label="목록 새로고침"
                  >
                    <Icon name="refresh" className={`h-4 w-4 ${isLoadingRooms ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    disabled={Boolean(authError)}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-primary-dark disabled:opacity-40"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    방 만들기
                  </button>
                </div>
              </div>
            </div>

            {/* 방 목록 컨텐츠 */}
            <div className="flex-1 overflow-y-auto bg-surface-muted/40 p-4 sm:p-5 min-h-0">
              {authError ? (
                <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-black/10 bg-surface text-danger shadow-xs">
                    <Icon name="alert" className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-ink">연결하지 못했어요</h3>
                  <p className="mt-1 text-xs text-ink-soft">{authError}</p>
                  <button
                    onClick={retryAuth}
                    className="mt-4 rounded-xl border border-black/10 bg-surface px-4 py-2 text-xs font-bold text-ink shadow-xs transition hover:bg-surface-muted"
                  >
                    다시 시도
                  </button>
                </div>
              ) : rooms.length > 0 ? (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  {rooms.map((room) => {
                    const isFull = room.playerCount >= room.maxPlayers;
                    const isInGame = room.status !== "waiting";
                    const isMyRoom = room.hostNickname === myNickname;

                    return (
                      <div
                        key={room.id}
                        className="flex flex-col justify-between rounded-2xl border border-black/5 bg-surface p-4 transition hover:border-primary/40 hover:shadow-sm"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-medium text-ink-soft">#{room.id}</span>
                            <div className="flex items-center gap-1.5">
                              {getModeBadge(room.gameMode)}
                              {room.hasPassword && (
                                <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-ink-soft border border-black/5">
                                  비공개
                                </span>
                              )}
                            </div>
                          </div>
                          <h3 className="mt-2 font-bold text-ink text-sm tracking-tight truncate">
                            {room.title}
                          </h3>
                          <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
                            <span>방장: <strong className="text-ink font-semibold">{room.hostNickname}</strong></span>
                            <span className="font-medium text-ink">
                              참여 <strong className="text-primary font-bold">{room.playerCount}</strong> / {room.maxPlayers}명
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
                          <div className="flex items-center gap-1.5">
                            {isInGame ? (
                              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                                진행 중
                              </span>
                            ) : isFull ? (
                              <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
                                정원 마감
                              </span>
                            ) : (
                              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                                입장 가능
                              </span>
                            )}

                            {/* 내가 만든 방 삭제 버튼 */}
                            {isMyRoom && (
                              <button
                                onClick={() => setRoomToDelete(room)}
                                className="rounded-md px-2 py-0.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition border border-rose-200"
                                title="방 삭제 또는 나가기"
                              >
                                삭제
                              </button>
                            )}
                          </div>

                          <button
                            onClick={() => handleJoinClick(room)}
                            disabled={isFull || isInGame}
                            className={`rounded-xl px-4 py-1.5 text-xs font-bold transition ${
                              isFull || isInGame
                                ? "cursor-not-allowed bg-surface-muted text-ink-soft"
                                : "bg-ink text-white hover:bg-primary"
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
                <div className="flex h-full flex-col items-center justify-center text-center py-12">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface border border-black/10 text-ink-soft mb-3 shadow-xs">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="font-bold text-ink text-base">열린 방이 없어요</h3>
                  <p className="mt-1 text-xs text-ink-soft">
                    방을 만들어 동료들을 초대하고 함께 점심을 결정해 보세요.
                  </p>
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition hover:bg-primary-dark shadow-xs"
                  >
                    새 방 만들기
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 1. 방 만들기 팝업 모달 */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-surface p-5 text-ink shadow-soft">
            <div className="flex items-center justify-between border-b border-black/5 pb-3">
              <h3 className="text-sm font-bold text-ink">새 방 개설하기</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-ink-soft hover:text-ink text-xs"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-3.5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-ink">
                  방 제목
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="예: 오늘 점심 같이 드실 분"
                  required
                  className="mt-1 w-full rounded-xl border border-black/10 bg-surface-muted/50 px-3 py-2 text-xs text-ink placeholder-ink-soft focus:border-primary focus:bg-surface focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink">
                  결정 방식
                </label>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setNewGameMode("speed-vote")}
                    className={`rounded-xl border p-2 text-center transition ${
                      newGameMode === "speed-vote"
                        ? "border-primary bg-primary-light text-primary-dark font-bold"
                        : "border-black/10 bg-surface text-ink-soft hover:border-black/20"
                    }`}
                  >
                    <div className="text-xs">스피드 투표</div>
                    <div className="text-xs text-ink-soft mt-0.5">15초 다수결</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewGameMode("worldcup")}
                    className={`rounded-xl border p-2 text-center transition ${
                      newGameMode === "worldcup"
                        ? "border-purple-500 bg-purple-50 text-purple-700 font-bold"
                        : "border-black/10 bg-surface text-ink-soft hover:border-black/20"
                    }`}
                  >
                    <div className="text-xs">메뉴 월드컵</div>
                    <div className="text-xs text-ink-soft mt-0.5">1:1 토너먼트</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewGameMode("roulette")}
                    className={`rounded-xl border p-2 text-center transition ${
                      newGameMode === "roulette"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold"
                        : "border-black/10 bg-surface text-ink-soft hover:border-black/20"
                    }`}
                  >
                    <div className="text-xs">운명의 룰렛</div>
                    <div className="text-xs text-ink-soft mt-0.5">랜덤 추첨</div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink">
                    최대 인원
                  </label>
                  <select
                    value={newMaxPlayers}
                    onChange={(e) => setNewMaxPlayers(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-surface-muted/50 px-2 py-2 text-xs text-ink focus:border-primary focus:bg-surface focus:outline-none"
                  >
                    <option value={2}>2명</option>
                    <option value={4}>4명</option>
                    <option value={6}>6명</option>
                    <option value={8}>8명</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink">
                    비밀번호 (선택)
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="미입력 시 공개방"
                    className="mt-1 w-full rounded-xl border border-black/10 bg-surface-muted/50 px-3 py-2 text-xs text-ink placeholder-ink-soft focus:border-primary focus:bg-surface focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2 border-t border-black/5 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-xl border border-black/10 px-3.5 py-1.5 text-xs text-ink-soft hover:bg-surface-muted"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newTitle.trim()}
                  className="rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-white transition hover:bg-primary-dark disabled:opacity-40"
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
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xs rounded-2xl border border-black/10 bg-surface p-5 text-ink shadow-soft">
            <h3 className="text-sm font-bold text-ink">비밀번호 확인</h3>
            <p className="mt-1 text-xs text-ink-soft truncate">
              &apos;{selectedRoomToJoin.title}&apos; 입장
            </p>

            <form onSubmit={handlePasswordJoinSubmit} className="mt-3.5 space-y-3">
              <input
                type="password"
                value={joinPasswordInput}
                onChange={(e) => setJoinPasswordInput(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                autoFocus
                className="w-full rounded-xl border border-black/10 bg-surface-muted/50 px-3 py-2 text-xs text-ink placeholder-ink-soft focus:border-primary focus:bg-surface focus:outline-none"
              />

              {joinError && (
                <div className="text-xs font-medium text-rose-500">{joinError}</div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedRoomToJoin(null)}
                  className="rounded-xl border border-black/10 px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-muted"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-dark"
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
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xs rounded-2xl border border-black/10 bg-surface p-5 text-ink shadow-soft">
            <h3 className="text-sm font-bold text-ink">방 삭제 / 나가기</h3>
            <p className="mt-2 text-xs text-ink-soft leading-relaxed">
              {roomToDelete.playerCount > 1
                ? `방에 다른 참여자(${roomToDelete.playerCount - 1}명)가 있습니다. 방장 권한을 넘기고 나만 나가시겠습니까, 아니면 방을 완전히 삭제하시겠습니까?`
                : "개설한 방을 삭제하시겠습니까?"}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {roomToDelete.playerCount > 1 && (
                <button
                  type="button"
                  onClick={() => handleDeleteRoom(false)}
                  className="w-full rounded-xl bg-ink py-2 text-xs font-bold text-white hover:bg-primary transition"
                >
                  방장 권한 넘기고 나만 나가기
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDeleteRoom(true)}
                className="w-full rounded-xl bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-700 transition"
              >
                방 완전히 삭제하기
              </button>
              <button
                type="button"
                onClick={() => setRoomToDelete(null)}
                className="w-full rounded-xl border border-black/10 py-1.5 text-xs text-ink-soft hover:bg-surface-muted transition"
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
