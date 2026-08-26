"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ref,
  onValue,
  set,
  push,
  update,
  remove,
  onDisconnect,
  get,
} from "firebase/database";
import { rtdb } from "@/lib/firebase-client";
import type {
  BattleCandidate,
  BattleChatMessage,
  BattleGameMode,
  BattlePickedRestaurant,
  BattlePlayer,
  BattleResult,
  BattleRoomDetail,
  BattleRoomSummary,
  BattleVoteState,
  BattleWorldcupMatch,
} from "@/types/battle";

interface UseBattleRoomProps {
  companyCode: string;
  myNicknameId: string;
  myNickname: string;
  onNotify?: (message: string) => void;
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * 한국 시간(KST, UTC+9) 기준 당일 자정(00:00:00)의 타임스탬프를 반환한다.
 */
function getTodayKstMidnight(): number {
  const now = new Date();
  const kstDateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // "YYYY-MM-DD"
  return new Date(`${kstDateStr}T00:00:00+09:00`).getTime();
}

export function useBattleRoom({
  companyCode,
  myNicknameId,
  myNickname,
  onNotify,
}: UseBattleRoomProps) {
  const [isConnected, setIsConnected] = useState(true);
  const [rooms, setRooms] = useState<BattleRoomSummary[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [currentRoom, setCurrentRoom] = useState<BattleRoomDetail | null>(null);
  const [messages, setMessages] = useState<BattleChatMessage[]>([]);
  const [voteState, setVoteState] = useState<BattleVoteState | null>(null);
  const [worldcupMatch, setWorldcupMatch] = useState<BattleWorldcupMatch | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);

  // 1. 방 목록 실시간 구독 (한국시간 기준 당일 방만 유지 및 자정 지난 방 자동 정리)
  useEffect(() => {
    if (!companyCode) return;
    setIsLoadingRooms(true);
    const roomsRef = ref(rtdb, `battles/${companyCode}/rooms`);
    const todayMidnight = getTodayKstMidnight();

    const unsubscribe = onValue(roomsRef, (snapshot) => {
      setIsLoadingRooms(false);
      if (!snapshot.exists()) {
        setRooms([]);
        return;
      }
      const data = snapshot.val();
      const list: BattleRoomSummary[] = [];

      Object.keys(data).forEach((roomId) => {
        const r = data[roomId];
        if (!r || !r.status) return;

        const createdAt = r.createdAt || 0;
        // 자정(00:00:00 KST) 이전에 개설된 오래된 방은 RTDB에서 자동 정리
        if (createdAt < todayMidnight) {
          remove(ref(rtdb, `battles/${companyCode}/rooms/${roomId}`)).catch(() => {});
          return;
        }

        const playersCount = r.players ? Object.keys(r.players).length : 0;
        list.push({
          id: roomId,
          title: r.title,
          companyCode,
          hostNickname: r.hostNickname || "방장",
          hasPassword: Boolean(r.password && r.password.trim().length > 0),
          maxPlayers: r.maxPlayers || 6,
          playerCount: playersCount,
          gameMode: r.gameMode || "speed-vote",
          status: r.status || "waiting",
          createdAt,
        });
      });

      setRooms(list.sort((a, b) => b.createdAt - a.createdAt));
    });

    return () => unsubscribe();
  }, [companyCode]);

  // 2. 현재 방 상세 실시간 구독
  useEffect(() => {
    if (!currentRoomId || !companyCode) return;
    const roomId = currentRoomId;
    const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        setCurrentRoom(null);
        setCurrentRoomId(null);
        setMessages([]);
        setVoteState(null);
        setWorldcupMatch(null);
        return;
      }

      const data = snapshot.val();
      const rawPlayers = data.players || {};
      const playersList: BattlePlayer[] = Object.values(rawPlayers);

      // 내가 방에서 나갔는지 체크
      const amIInRoom = playersList.some(
        (p) => p.nicknameId === myNicknameId || p.nickname === myNickname
      );
      if (!amIInRoom) {
        setCurrentRoom(null);
        setCurrentRoomId(null);
        return;
      }

      const rawCandidates = data.candidates || {};
      const candidatesList: BattleCandidate[] = Object.values(rawCandidates);

      const rawMessages = data.messages || {};
      const messagesList: BattleChatMessage[] = (Object.values(rawMessages) as BattleChatMessage[]).sort(
        (a, b) => {
          const tA = new Date(a.createdAt).getTime() || 0;
          const tB = new Date(b.createdAt).getTime() || 0;
          return tA - tB;
        }
      );

      const roomDetail: BattleRoomDetail = {
        id: roomId,
        title: data.title,
        companyCode,
        hostNicknameId: data.hostNicknameId,
        hostNickname: data.hostNickname,
        hasPassword: Boolean(data.password && data.password.trim().length > 0),
        maxPlayers: data.maxPlayers || 6,
        gameMode: data.gameMode || "speed-vote",
        status: data.status || "waiting",
        players: playersList,
        candidates: candidatesList,
        messages: messagesList,
        voteState: data.voteState || undefined,
        worldcupMatch: data.worldcupMatch || undefined,
        rouletteState: data.rouletteState || undefined,
        result: data.result || undefined,
        createdAt: data.createdAt || Date.now(),
      };

      setCurrentRoom(roomDetail);
      setMessages(messagesList);
      setVoteState(data.voteState || null);
      setWorldcupMatch(data.worldcupMatch || null);
    });

    return () => unsubscribe();
  }, [companyCode, currentRoomId, myNickname, myNicknameId]);

  const refreshRooms = useCallback(() => {
    setIsLoadingRooms(true);
    setTimeout(() => setIsLoadingRooms(false), 300);
  }, []);

  // 3. 방 만들기
  const createRoom = useCallback(
    async (
      title: string,
      password?: string,
      maxPlayers: number = 6,
      gameMode: BattleGameMode = "speed-vote"
    ) => {
      try {
        const roomId = generateRoomId();
        const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

        const hostPlayer: BattlePlayer = {
          socketId: myNicknameId,
          nicknameId: myNicknameId,
          nickname: myNickname,
          isHost: true,
          isReady: true,
          slotIndex: 0,
        };

        const nowIso = new Date().toISOString();
        const initialData = {
          id: roomId,
          title: title || `${myNickname}님의 방`,
          companyCode,
          hostNicknameId: myNicknameId,
          hostNickname: myNickname,
          password: password?.trim() || "",
          maxPlayers: Math.min(Math.max(maxPlayers || 6, 2), 8),
          gameMode: gameMode || "speed-vote",
          status: "waiting",
          players: {
            [myNicknameId]: hostPlayer,
          },
          candidates: {},
          messages: {
            [`msg_${Date.now()}`]: {
              id: `sys-${Date.now()}`,
              senderNickname: "SYSTEM",
              content: `${myNickname}님이 방을 개설했습니다.`,
              createdAt: nowIso,
              isSystem: true,
            },
          },
          createdAt: Date.now(),
        };

        await set(roomRef, initialData);

        // 연결 끊김 시 내 슬롯 자동 제거
        const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);
        onDisconnect(myPlayerRef).remove();

        setCurrentRoomId(roomId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || "방 생성에 실패했습니다." };
      }
    },
    [companyCode, myNickname, myNicknameId]
  );

  // 4. 방 입장하기
  const joinRoom = useCallback(
    async (roomId: string, password?: string) => {
      try {
        const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);
        const snapshot = await get(roomRef);

        if (!snapshot.exists()) {
          return { success: false, error: "존재하지 않는 방입니다." };
        }

        const data = snapshot.val();
        if (data.password && data.password !== password) {
          return { success: false, error: "비밀번호가 일치하지 않습니다." };
        }

        if (data.status !== "waiting") {
          return { success: false, error: "이미 게임이 시작되었거나 종료된 방입니다." };
        }

        const currentPlayers: Record<string, BattlePlayer> = data.players || {};
        const playersList = Object.values(currentPlayers);

        // 이미 들어가 있는 경우
        if (currentPlayers[myNicknameId]) {
          setCurrentRoomId(roomId);
          return { success: true };
        }

        if (playersList.length >= (data.maxPlayers || 6)) {
          return { success: false, error: "정원이 가득 찬 방입니다." };
        }

        // 빈 슬롯 찾기
        const occupiedSlots = new Set(playersList.map((p) => p.slotIndex));
        let availableSlot = -1;
        for (let i = 0; i < (data.maxPlayers || 6); i++) {
          if (!occupiedSlots.has(i)) {
            availableSlot = i;
            break;
          }
        }

        const newPlayer: BattlePlayer = {
          socketId: myNicknameId,
          nicknameId: myNicknameId,
          nickname: myNickname,
          isHost: false,
          isReady: false,
          slotIndex: availableSlot >= 0 ? availableSlot : playersList.length,
        };

        const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);
        await set(myPlayerRef, newPlayer);
        onDisconnect(myPlayerRef).remove();

        const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `${myNickname}님이 입장했습니다.`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });

        setCurrentRoomId(roomId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || "입장에 실패했습니다." };
      }
    },
    [companyCode, myNickname, myNicknameId]
  );

  // 5. 방 나가기
  const leaveRoom = useCallback(async () => {
    if (!currentRoomId || !companyCode) return;
    const roomId = currentRoomId;
    const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);
    const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);

    try {
      const snapshot = await get(roomRef);
      if (snapshot.exists()) {
        const data = snapshot.val();
        const players = data.players || {};
        const remainingKeys = Object.keys(players).filter((k) => k !== myNicknameId);

        if (remainingKeys.length === 0) {
          // 마지막 유저가 나가면 방 전체 삭제
          await remove(roomRef);
        } else {
          await remove(myPlayerRef);

          // 방장이 나간 경우 다음 사람에게 방장 위임
          let transferMsg = `${myNickname}님이 퇴장했습니다.`;
          if (data.hostNicknameId === myNicknameId || data.hostNickname === myNickname) {
            const nextHostKey = remainingKeys[0];
            const nextHost = players[nextHostKey];
            await update(roomRef, {
              hostNicknameId: nextHost.nicknameId,
              hostNickname: nextHost.nickname,
              [`players/${nextHostKey}/isHost`]: true,
              [`players/${nextHostKey}/isReady`]: true,
            });
            transferMsg = `방장 ${myNickname}님이 퇴장하여 ${nextHost.nickname}님에게 방장 권한이 위임되었습니다.`;
          }

          const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
          await push(messagesRef, {
            id: `sys-${Date.now()}`,
            senderNickname: "SYSTEM",
            content: transferMsg,
            createdAt: new Date().toISOString(),
            isSystem: true,
          });
        }
      }
    } catch (e) {
      console.error("Error leaving room:", e);
    }

    setCurrentRoomId(null);
    setCurrentRoom(null);
    setMessages([]);
    setVoteState(null);
    setWorldcupMatch(null);
  }, [companyCode, currentRoomId, myNickname, myNicknameId]);

  // 5-2. 방장 권한 수동 위임
  const transferHost = useCallback(
    async (targetNicknameId: string) => {
      if (!currentRoomId || !companyCode) return;
      const roomId = currentRoomId;
      const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

      try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        const players = data.players || {};
        const targetPlayer = players[targetNicknameId];
        if (!targetPlayer) return;

        await update(roomRef, {
          hostNicknameId: targetPlayer.nicknameId,
          hostNickname: targetPlayer.nickname,
          [`players/${myNicknameId}/isHost`]: false,
          [`players/${myNicknameId}/isReady`]: false,
          [`players/${targetNicknameId}/isHost`]: true,
          [`players/${targetNicknameId}/isReady`]: true,
        });

        const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `${myNickname}님이 ${targetPlayer.nickname}님에게 방장 권한을 위임했습니다.`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      } catch (err) {
        console.error("Failed to transfer host:", err);
      }
    },
    [companyCode, currentRoomId, myNickname, myNicknameId]
  );

  // 5-3. 로비에서 방 삭제 (방장 전용 / 다른 참가자가 있으면 권한 위임 후 나만 나오기 or 전체 삭제)
  const deleteRoomFromLobby = useCallback(
    async (roomId: string, forceDeleteAll: boolean = false) => {
      if (!companyCode || !roomId) return;
      const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

      try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        const players = data.players || {};
        const remainingKeys = Object.keys(players).filter((k) => k !== myNicknameId);

        if (remainingKeys.length === 0 || forceDeleteAll) {
          await remove(roomRef);
        } else {
          // 다른 참가자에게 위임하고 방장만 방에서 빠져나오기
          const nextHostKey = remainingKeys[0];
          const nextHost = players[nextHostKey];
          const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);
          await remove(myPlayerRef);
          await update(roomRef, {
            hostNicknameId: nextHost.nicknameId,
            hostNickname: nextHost.nickname,
            [`players/${nextHostKey}/isHost`]: true,
            [`players/${nextHostKey}/isReady`]: true,
          });

          const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
          await push(messagesRef, {
            id: `sys-${Date.now()}`,
            senderNickname: "SYSTEM",
            content: `개설자 ${myNickname}님이 방을 나가서 ${nextHost.nickname}님에게 방장 권한이 위임되었습니다.`,
            createdAt: new Date().toISOString(),
            isSystem: true,
          });
        }
      } catch (err) {
        console.error("Failed to delete room from lobby:", err);
      }
    },
    [companyCode, myNickname, myNicknameId]
  );

  // 6. 준비(READY) 토글
  const toggleReady = useCallback(async () => {
    if (!currentRoomId || !currentRoom) return;
    const me = currentRoom.players.find((p) => p.nicknameId === myNicknameId || p.nickname === myNickname);
    const isHost = me?.isHost || currentRoom.hostNicknameId === myNicknameId || currentRoom.hostNickname === myNickname;
    if (!me || isHost) return;

    const myPlayerRef = ref(
      rtdb,
      `battles/${companyCode}/rooms/${currentRoomId}/players/${myNicknameId}`
    );
    await update(myPlayerRef, { isReady: !me.isReady });
  }, [companyCode, currentRoom, currentRoomId, myNickname, myNicknameId]);

  // 7. 식당 픽하기 (새 후보 등록 및 내 대표 픽 설정)
  const pickRestaurant = useCallback(
    async (restaurant: BattlePickedRestaurant) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);
      await update(myPlayerRef, { pickedRestaurant: restaurant });

      const candId = `cand-${Date.now()}`;
      const candRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/candidates/${candId}`);
      await set(candRef, {
        id: candId,
        name: restaurant.name,
        category: restaurant.category || "식당",
        restaurantId: restaurant.id,
        addedByNickname: myNickname,
        zeroPay: restaurant.zeroPay,
      });

      const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
      await push(messagesRef, {
        id: `sys-${Date.now()}`,
        senderNickname: "SYSTEM",
        content: `${myNickname}님이 후보로 '${restaurant.name}'을(를) 등록했습니다.`,
        createdAt: new Date().toISOString(),
        isSystem: true,
      });
    },
    [companyCode, currentRoom, currentRoomId, myNickname, myNicknameId]
  );

  // 7-2. 기존 등록된 후보 중 하나를 내 대표 픽으로 설정
  const setMyPickedCandidate = useCallback(
    async (cand: BattleCandidate) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);
      await update(myPlayerRef, {
        pickedRestaurant: {
          id: cand.restaurantId,
          name: cand.name,
          category: cand.category,
          zeroPay: cand.zeroPay,
        },
      });
    },
    [companyCode, currentRoom, currentRoomId, myNicknameId]
  );

  // 7-3. 후보 삭제 (내가 등록한 후보이거나 방장인 경우)
  const removeCandidate = useCallback(
    async (candidateId: string) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      const candRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/candidates/${candidateId}`);
      await remove(candRef);
    },
    [companyCode, currentRoom, currentRoomId]
  );

  // 8. 메뉴 직접 추가
  const addCandidate = useCallback(
    async (name: string, category?: string) => {
      if (!currentRoomId || !name.trim()) return;
      const roomId = currentRoomId;
      const candId = `cand-${Date.now()}`;
      const candRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/candidates/${candId}`);

      await set(candRef, {
        id: candId,
        name: name.trim(),
        category: category || "기타",
        addedByNickname: myNickname,
      });

      const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myNicknameId}`);
      await update(myPlayerRef, {
        pickedRestaurant: {
          name: name.trim(),
          category: category || "기타",
        },
      });

      const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
      await push(messagesRef, {
        id: `sys-${Date.now()}`,
        senderNickname: "SYSTEM",
        content: `${myNickname}님이 후보로 '${name.trim()}'을(를) 추가했습니다.`,
        createdAt: new Date().toISOString(),
        isSystem: true,
      });
    },
    [companyCode, currentRoomId, myNickname, myNicknameId]
  );

  // 9. 채팅 메시지 전송
  const sendChatMessage = useCallback(
    async (content: string) => {
      if (!currentRoomId || !content.trim()) return;
      const roomId = currentRoomId;
      const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);

      await push(messagesRef, {
        id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        senderNickname: myNickname,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        isSystem: false,
      });
    },
    [companyCode, currentRoomId, myNickname]
  );

  // 10. 게임 시작 (방장 전용 - 모든 클라이언트 실시간 동기화)
  const startGame = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!currentRoomId || !currentRoom) {
      return { success: false, error: "방 정보를 찾을 수 없습니다." };
    }
    const me = currentRoom.players.find(
      (p) => p.nicknameId === myNicknameId || p.nickname === myNickname
    );
    const isHost =
      me?.isHost ||
      currentRoom.hostNicknameId === myNicknameId ||
      currentRoom.hostNickname === myNickname;
    if (!isHost) {
      return { success: false, error: "방장만 시작할 수 있습니다." };
    }

    const candidatesList = Array.isArray(currentRoom.candidates)
      ? currentRoom.candidates
      : Object.values(currentRoom.candidates || {});

    if (candidatesList.length < 2) {
      return { success: false, error: "메뉴 후보가 최소 2개 이상 등록되어야 합니다." };
    }

    const roomId = currentRoomId;
    const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

    if (currentRoom.gameMode === "speed-vote") {
      const voteState: BattleVoteState = {
        startedAt: Date.now(),
        durationSeconds: 15,
        votes: {},
      };
      await update(roomRef, {
        status: "in-game",
        voteState,
      });

      // 15초 후 모든 참가자 화면이 동시에 승자 결과 화면으로 전환
      setTimeout(async () => {
        const snap = await get(roomRef);
        if (!snap.exists()) return;
        const currentData = snap.val();
        if (currentData.status !== "in-game") return;

        const currentVotes: Record<string, string> =
          currentData.voteState && typeof currentData.voteState.votes === "object"
            ? currentData.voteState.votes
            : {};
        const cands: BattleCandidate[] = Object.values(currentData.candidates || {});
        const counts: Record<string, number> = {};
        cands.forEach((c) => (counts[c.id] = 0));
        Object.values(currentVotes).forEach((candId) => {
          if (candId) counts[candId] = (counts[candId] || 0) + 1;
        });

        let max = -1;
        let top: BattleCandidate[] = [];
        cands.forEach((c) => {
          const v = counts[c.id] || 0;
          if (v > max) {
            max = v;
            top = [c];
          } else if (v === max) {
            top.push(c);
          }
        });

        const winner = top[Math.floor(Math.random() * top.length)] || cands[0];
        const result: BattleResult = {
          winner,
          gameMode: "speed-vote",
          totalParticipants: Object.keys(currentData.players || {}).length,
          finishedAt: new Date().toISOString(),
        };

        await update(roomRef, {
          status: "finished",
          result,
        });
      }, 15000);
    } else if (currentRoom.gameMode === "roulette") {
      const cands: BattleCandidate[] = Object.values(currentRoom.candidates || {});
      const winner = cands[Math.floor(Math.random() * cands.length)] || cands[0];
      const rouletteState = {
        startedAt: Date.now(),
        durationMs: 5000,
        winnerCandidateId: winner.id,
      };

      await update(roomRef, {
        status: "in-game",
        rouletteState,
      });

      // 5초 동안 전원 동일한 감속 롤링 애니메이션 후 동시에 결과 전환
      setTimeout(async () => {
        const snap = await get(roomRef);
        if (!snap.exists()) return;
        const currentData = snap.val();
        if (currentData.status !== "in-game") return;

        const result: BattleResult = {
          winner,
          gameMode: "roulette",
          totalParticipants: Object.keys(currentData.players || {}).length,
          finishedAt: new Date().toISOString(),
        };
        await update(roomRef, {
          status: "finished",
          result,
        });
      }, 5000);
    } else if (currentRoom.gameMode === "worldcup") {
      const shuffled = [...candidatesList].sort(() => Math.random() - 0.5);
      const match = {
        matchIndex: 1,
        roundName: shuffled.length <= 2 ? "결승전" : "토너먼트",
        candidateA: shuffled[0],
        candidateB: shuffled[1],
        votesA: {},
        votesB: {},
        durationSeconds: 8,
        startedAt: Date.now(),
      };

      await update(roomRef, {
        status: "in-game",
        worldcupMatch: match,
      });

      // 8초 후 다수결 승자 판정 및 결과 전환 (전원 동시)
      setTimeout(async () => {
        const snap = await get(roomRef);
        if (!snap.exists()) return;
        const currentData = snap.val();
        if (currentData.status !== "in-game") return;

        const curMatch = currentData.worldcupMatch || {};
        const countA = curMatch.votesA ? Object.keys(curMatch.votesA).length : 0;
        const countB = curMatch.votesB ? Object.keys(curMatch.votesB).length : 0;

        const candA = curMatch.candidateA || shuffled[0];
        const candB = curMatch.candidateB || shuffled[1];
        const winner = countA >= countB ? candA : candB;

        const result: BattleResult = {
          winner,
          gameMode: "worldcup",
          totalParticipants: Object.keys(currentData.players || {}).length,
          finishedAt: new Date().toISOString(),
        };
        await update(roomRef, {
          status: "finished",
          result,
        });
      }, 8000);
    }

    return { success: true };
  }, [companyCode, currentRoom, currentRoomId, myNickname, myNicknameId]);

  // 11. 투표하기
  const castVote = useCallback(
    async (candidateId: string) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      if (currentRoom.gameMode === "speed-vote") {
        const voteRef = ref(
          rtdb,
          `battles/${companyCode}/rooms/${roomId}/voteState/votes/${myNicknameId}`
        );
        await set(voteRef, candidateId);
      } else if (currentRoom.gameMode === "worldcup" && currentRoom.worldcupMatch) {
        const match = currentRoom.worldcupMatch;
        const candAId = match.candidateA?.id;
        const candBId = match.candidateB?.id;

        if (candidateId === candAId) {
          const voteARef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesA/${myNicknameId}`
          );
          const voteBRef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesB/${myNicknameId}`
          );
          await set(voteARef, true);
          await remove(voteBRef);
        } else if (candidateId === candBId) {
          const voteARef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesA/${myNicknameId}`
          );
          const voteBRef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesB/${myNicknameId}`
          );
          await set(voteBRef, true);
          await remove(voteARef);
        }
      }
    },
    [companyCode, currentRoom, currentRoomId, myNicknameId]
  );

  // 12. 게임 종료 후 대기실로 복귀 (방장/참가자 공유)
  const returnToWaitingRoom = useCallback(async () => {
    if (!currentRoomId || !companyCode) return;
    const roomId = currentRoomId;
    const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

    try {
      const snap = await get(roomRef);
      if (snap.exists()) {
        const data = snap.val();
        const players = data.players || {};
        const updatedPlayers: Record<string, any> = {};

        Object.keys(players).forEach((k) => {
          const p = players[k];
          const isHost =
            p.isHost ||
            k === data.hostNicknameId ||
            p.nickname === data.hostNickname;

          updatedPlayers[k] = {
            ...p,
            isReady: isHost ? true : false,
          };
        });

        await update(roomRef, {
          status: "waiting",
          result: null,
          voteState: null,
          worldcupMatch: null,
          rouletteState: null,
          players: updatedPlayers,
        });

        const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `${myNickname}님이 대기실로 복귀시켰습니다. 다음 게임을 준비해주세요!`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      }
    } catch (err) {
      console.error("Failed to return to waiting room:", err);
    }
  }, [companyCode, currentRoomId, myNickname]);

  return {
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
  };
}
