"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  ref,
  onValue,
  set,
  push,
  update,
  remove,
  onDisconnect,
  get,
  goOnline,
  goOffline,
} from "firebase/database";
import { rtdb } from "@/lib/firebase-client";
import { ensureBattleAuth } from "@/lib/battle-auth";
import { toBattleKey } from "@/lib/battle-key";
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

// RTDB 데이터 구조 (보안 규칙: database.rules.json)
// - battles/{cc}/lobby/{roomId}     : 로비 목록용 가벼운 요약 + members/{배틀키}: true
// - battles/{cc}/rooms/{roomId}     : 방 상세(플레이어/후보/채팅/게임 상태). 비밀번호는 여기 두지 않는다.
// - battleSecrets/{cc}/{roomId}     : 방 비밀번호 (클라이언트 읽기 불가)
// - battleAccess/{cc}/{roomId}/{bk} : 입장 시 입력한 비밀번호. 규칙이 secrets와 일치할 때만 쓰기를 허용한다.
//
// 비용 메모: 예전엔 로비가 rooms 전체(채팅/투표 포함)를 구독해서, 어느 방에서든 채팅 한 줄이 오가면
// 접속 중인 모든 사용자에게 그 변경이 전송됐다. 지금은 로비는 lobby 요약만, 방 상세는 들어간 방만 구독한다.
// 또 배틀 모달이 열려 있을 때만 이 훅이 마운트되고, 닫히면 goOffline으로 RTDB 연결 자체를 끊는다.

const STALE_EMPTY_ROOM_MS = 2 * 60 * 1000; // 참가자가 0명인 채로 이 시간이 지난 방은 정리 대상

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

function roomPath(companyCode: string, roomId: string) {
  return `battles/${companyCode}/rooms/${roomId}`;
}

function lobbyPath(companyCode: string, roomId: string) {
  return `battles/${companyCode}/lobby/${roomId}`;
}

function systemMessage(content: string) {
  return {
    id: `sys-${Date.now()}`,
    senderNickname: "SYSTEM",
    content,
    createdAt: new Date().toISOString(),
    isSystem: true,
  };
}

// 방 상태를 바꾸면서, 로비 요약에 보이는 필드(status/gameMode/hostNickname)가 바뀌면 lobby도 같이 맞춘다.
async function updateRoomAndLobby(
  companyCode: string,
  roomId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await update(ref(rtdb, roomPath(companyCode, roomId)), patch);
  const lobbyPatch: Record<string, unknown> = {};
  for (const field of ["status", "gameMode", "hostNickname"]) {
    if (patch[field] !== undefined) lobbyPatch[field] = patch[field];
  }
  if (Object.keys(lobbyPatch).length > 0) {
    await update(ref(rtdb, lobbyPath(companyCode, roomId)), lobbyPatch).catch(() => {});
  }
}

// 방 삭제 후 로비 요약/비밀번호/내 입장 기록까지 정리. 방을 먼저 지워야 규칙상 나머지 삭제가 허용된다.
async function removeRoomCompletely(companyCode: string, roomId: string, myKey: string): Promise<void> {
  await remove(ref(rtdb, roomPath(companyCode, roomId)));
  await Promise.all([
    remove(ref(rtdb, lobbyPath(companyCode, roomId))).catch(() => {}),
    remove(ref(rtdb, `battleSecrets/${companyCode}/${roomId}`)).catch(() => {}),
    remove(ref(rtdb, `battleAccess/${companyCode}/${roomId}/${myKey}`)).catch(() => {}),
  ]);
}

export function useBattleRoom({
  companyCode,
  myNicknameId,
  myNickname,
  onNotify,
}: UseBattleRoomProps) {
  const myKey = useMemo(() => toBattleKey(myNicknameId), [myNicknameId]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  // 배틀용 Firebase 로그인 실패 메시지 (사용자에게 보여 줄 문장). 실패하면 방 목록·방 만들기가 동작하지 않는다.
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [rooms, setRooms] = useState<BattleRoomSummary[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [currentRoom, setCurrentRoom] = useState<BattleRoomDetail | null>(null);
  const [messages, setMessages] = useState<BattleChatMessage[]>([]);
  const [voteState, setVoteState] = useState<BattleVoteState | null>(null);
  const [worldcupMatch, setWorldcupMatch] = useState<BattleWorldcupMatch | null>(null);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const cleanupAttemptedRef = useRef<Set<string>>(new Set());
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  // 0. RTDB 연결 및 Firebase 인증 (훅이 마운트된 동안에만 연결 유지)
  useEffect(() => {
    if (!companyCode || !myNicknameId) return;
    let cancelled = false;
    goOnline(rtdb);

    const unsubscribeConnected = onValue(ref(rtdb, ".info/connected"), (snap) => {
      setIsConnected(snap.val() === true);
    });

    setAuthError(null);
    ensureBattleAuth(companyCode, myNicknameId)
      .then(() => {
        if (!cancelled) setIsAuthReady(true);
      })
      .catch((err: Error) => {
        // Firebase 원문 오류("auth/configuration-not-found" 등)는 사용자에게 보여 주지 않고 콘솔에만 남긴다.
        console.error("[battle] 실시간 배틀 로그인 실패:", err);
        if (!cancelled) setAuthError("잠시 후 다시 시도해 주세요. 계속 안 되면 관리자에게 알려 주세요.");
      });

    return () => {
      cancelled = true;
      setIsAuthReady(false);
      unsubscribeConnected();
      // 연결을 끊으면 onDisconnect로 걸어둔 내 플레이어/로비 멤버 항목도 서버에서 자동 정리된다.
      goOffline(rtdb);
    };
  }, [companyCode, myNicknameId, authAttempt]);

  const retryAuth = useCallback(() => setAuthAttempt((n) => n + 1), []);

  // 1. 로비 목록 실시간 구독 (요약 노드만 - 한국시간 기준 당일 방만 표시, 오래된/빈 방 정리)
  useEffect(() => {
    if (!companyCode || !isAuthReady) return;
    setIsLoadingRooms(true);
    const lobbyRef = ref(rtdb, `battles/${companyCode}/lobby`);

    const unsubscribe = onValue(
      lobbyRef,
      (snapshot) => {
        setIsLoadingRooms(false);
        if (!snapshot.exists()) {
          setRooms([]);
          return;
        }
        const data = snapshot.val() as Record<string, any>;
        const todayMidnight = getTodayKstMidnight();
        const now = Date.now();
        const list: BattleRoomSummary[] = [];

        Object.keys(data).forEach((roomId) => {
          const r = data[roomId];
          if (!r || !r.status) return;

          const createdAt = r.createdAt || 0;
          const playerCount = r.members ? Object.keys(r.members).length : 0;
          const isOld = createdAt < todayMidnight;
          const isAbandoned = playerCount === 0 && now - createdAt > STALE_EMPTY_ROOM_MS;

          if (isOld || isAbandoned) {
            // 규칙상 허용되는 경우(빈 방 / 12시간 경과 / 내가 방장)에만 실제로 지워진다. 같은 방은 한 번만 시도.
            if (!cleanupAttemptedRef.current.has(roomId)) {
              cleanupAttemptedRef.current.add(roomId);
              removeRoomCompletely(companyCode, roomId, myKey).catch(() => {});
            }
            return;
          }

          list.push({
            id: roomId,
            title: r.title,
            companyCode,
            hostNickname: r.hostNickname || "방장",
            hasPassword: Boolean(r.hasPassword),
            maxPlayers: r.maxPlayers || 6,
            playerCount,
            gameMode: r.gameMode || "speed-vote",
            status: r.status || "waiting",
            createdAt,
          });
        });

        setRooms(list.sort((a, b) => b.createdAt - a.createdAt));
      },
      () => {
        setIsLoadingRooms(false);
        setRooms([]);
      }
    );

    return () => unsubscribe();
  }, [companyCode, isAuthReady, myKey]);

  // 2. 현재 방 상세 실시간 구독
  useEffect(() => {
    if (!currentRoomId || !companyCode || !isAuthReady) return;
    const roomId = currentRoomId;
    const roomRef = ref(rtdb, roomPath(companyCode, roomId));

    const resetRoomState = () => {
      setCurrentRoom(null);
      setCurrentRoomId(null);
      setMessages([]);
      setVoteState(null);
      setWorldcupMatch(null);
    };

    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          resetRoomState();
          return;
        }

        const data = snapshot.val();
        const rawPlayers: Record<string, BattlePlayer> = data.players || {};
        const playersList: BattlePlayer[] = Object.values(rawPlayers);

        // 내가 방에서 나갔는지 체크
        if (!rawPlayers[myKey]) {
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
          hostKey: data.hostKey,
          hostNickname: data.hostNickname,
          hasPassword: Boolean(data.hasPassword),
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
      },
      () => resetRoomState()
    );

    return () => unsubscribe();
  }, [companyCode, currentRoomId, isAuthReady, myKey]);

  // 로비는 실시간 구독이라 별도 재조회가 필요 없다 - 버튼 피드백만 준다.
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
      if (!isAuthReady) return { success: false, error: "실시간 연결을 준비 중입니다. 잠시 후 다시 시도해주세요." };
      try {
        const roomId = generateRoomId();
        const trimmedPassword = password?.trim() || "";
        if (trimmedPassword.length > 30) {
          return { success: false, error: "비밀번호는 30자 이하로 입력해주세요." };
        }

        const hostPlayer: BattlePlayer = {
          socketId: myKey,
          nicknameId: myNicknameId,
          nickname: myNickname,
          isHost: true,
          isReady: true,
          slotIndex: 0,
        };

        const createdAt = Date.now();
        const roomTitle = (title || `${myNickname}님의 방`).slice(0, 40);
        const safeMaxPlayers = Math.min(Math.max(maxPlayers || 6, 2), 8);
        const initialData = {
          id: roomId,
          title: roomTitle,
          companyCode,
          hostNicknameId: myNicknameId,
          hostKey: myKey,
          hostNickname: myNickname,
          hasPassword: trimmedPassword.length > 0,
          maxPlayers: safeMaxPlayers,
          gameMode: gameMode || "speed-vote",
          status: "waiting",
          players: {
            [myKey]: hostPlayer,
          },
          candidates: {},
          messages: {
            [`msg_${createdAt}`]: systemMessage(`${myNickname}님이 방을 개설했습니다.`),
          },
          createdAt,
        };

        // 순서 중요: 방 → 비밀번호 → 로비 요약. 로비에 노출되기 전에 비밀번호가 먼저 걸리게 한다.
        await set(ref(rtdb, roomPath(companyCode, roomId)), initialData);
        if (trimmedPassword) {
          await set(ref(rtdb, `battleSecrets/${companyCode}/${roomId}`), { password: trimmedPassword });
        }
        await set(ref(rtdb, lobbyPath(companyCode, roomId)), {
          title: roomTitle,
          hostNickname: myNickname,
          hasPassword: trimmedPassword.length > 0,
          maxPlayers: safeMaxPlayers,
          gameMode: gameMode || "speed-vote",
          status: "waiting",
          createdAt,
          members: { [myKey]: true },
        });

        // 연결 끊김 시 내 슬롯 자동 제거
        onDisconnect(ref(rtdb, `${roomPath(companyCode, roomId)}/players/${myKey}`)).remove();
        onDisconnect(ref(rtdb, `${lobbyPath(companyCode, roomId)}/members/${myKey}`)).remove();

        setCurrentRoomId(roomId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || "방 생성에 실패했습니다." };
      }
    },
    [companyCode, isAuthReady, myKey, myNickname, myNicknameId]
  );

  // 4. 방 입장하기
  const joinRoom = useCallback(
    async (roomId: string, password?: string) => {
      if (!isAuthReady) return { success: false, error: "실시간 연결을 준비 중입니다. 잠시 후 다시 시도해주세요." };
      try {
        const snapshot = await get(ref(rtdb, roomPath(companyCode, roomId)));

        if (!snapshot.exists()) {
          return { success: false, error: "존재하지 않는 방입니다." };
        }

        const data = snapshot.val();
        const currentPlayers: Record<string, BattlePlayer> = data.players || {};
        const playersList = Object.values(currentPlayers);

        // 이미 들어가 있는 경우
        if (currentPlayers[myKey]) {
          setCurrentRoomId(roomId);
          return { success: true };
        }

        if (data.status !== "waiting") {
          return { success: false, error: "이미 게임이 시작되었거나 종료된 방입니다." };
        }

        if (playersList.length >= (data.maxPlayers || 6)) {
          return { success: false, error: "정원이 가득 찬 방입니다." };
        }

        // 비밀번호 방: 서버 규칙이 battleSecrets와 일치하는 값만 쓰기를 허용한다.
        // 비밀번호 자체는 클라이언트로 내려오지 않는다.
        if (data.hasPassword) {
          try {
            await set(ref(rtdb, `battleAccess/${companyCode}/${roomId}/${myKey}`), password ?? "");
          } catch {
            return { success: false, error: "비밀번호가 일치하지 않습니다." };
          }
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
          socketId: myKey,
          nicknameId: myNicknameId,
          nickname: myNickname,
          isHost: false,
          isReady: false,
          slotIndex: availableSlot >= 0 ? availableSlot : playersList.length,
        };

        const myPlayerRef = ref(rtdb, `${roomPath(companyCode, roomId)}/players/${myKey}`);
        const myMemberRef = ref(rtdb, `${lobbyPath(companyCode, roomId)}/members/${myKey}`);
        await set(myPlayerRef, newPlayer);
        await set(myMemberRef, true);
        onDisconnect(myPlayerRef).remove();
        onDisconnect(myMemberRef).remove();

        await push(
          ref(rtdb, `${roomPath(companyCode, roomId)}/messages`),
          systemMessage(`${myNickname}님이 입장했습니다.`)
        );

        setCurrentRoomId(roomId);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || "입장에 실패했습니다." };
      }
    },
    [companyCode, isAuthReady, myKey, myNickname, myNicknameId]
  );

  // 방장 위임 + 퇴장 메시지 + 내 슬롯 제거. 규칙상 방 멤버만 방을 수정할 수 있으므로
  // 위임/메시지를 먼저 쓰고 마지막에 내 슬롯을 지운다.
  const leaveRoomInternal = useCallback(
    async (roomId: string, data: any, leaveMessage: (nextHostNickname?: string) => string) => {
      const players: Record<string, BattlePlayer> = data.players || {};
      const remainingKeys = Object.keys(players).filter((k) => k !== myKey);

      if (remainingKeys.length === 0) {
        // 마지막 유저가 나가면 방 전체 삭제
        await removeRoomCompletely(companyCode, roomId, myKey);
        return;
      }

      const isHostLeaving = data.hostKey === myKey || data.hostNicknameId === myNicknameId;
      let nextHostNickname: string | undefined;
      if (isHostLeaving) {
        const nextHostKey = remainingKeys[0];
        const nextHost = players[nextHostKey];
        nextHostNickname = nextHost.nickname;
        await updateRoomAndLobby(companyCode, roomId, {
          hostNicknameId: nextHost.nicknameId,
          hostKey: nextHostKey,
          hostNickname: nextHost.nickname,
          [`players/${nextHostKey}/isHost`]: true,
          [`players/${nextHostKey}/isReady`]: true,
        });
      }

      await push(ref(rtdb, `${roomPath(companyCode, roomId)}/messages`), systemMessage(leaveMessage(nextHostNickname)));
      await remove(ref(rtdb, `${lobbyPath(companyCode, roomId)}/members/${myKey}`)).catch(() => {});
      await remove(ref(rtdb, `${roomPath(companyCode, roomId)}/players/${myKey}`));
      await remove(ref(rtdb, `battleAccess/${companyCode}/${roomId}/${myKey}`)).catch(() => {});
    },
    [companyCode, myKey, myNicknameId]
  );

  // 5. 방 나가기
  const leaveRoom = useCallback(async () => {
    if (!currentRoomId || !companyCode) return;
    const roomId = currentRoomId;

    try {
      const snapshot = await get(ref(rtdb, roomPath(companyCode, roomId)));
      if (snapshot.exists()) {
        await leaveRoomInternal(roomId, snapshot.val(), (nextHostNickname) =>
          nextHostNickname
            ? `방장 ${myNickname}님이 퇴장하여 ${nextHostNickname}님에게 방장 권한이 위임되었습니다.`
            : `${myNickname}님이 퇴장했습니다.`
        );
      }
    } catch (e) {
      console.error("Error leaving room:", e);
    }

    setCurrentRoomId(null);
    setCurrentRoom(null);
    setMessages([]);
    setVoteState(null);
    setWorldcupMatch(null);
  }, [companyCode, currentRoomId, leaveRoomInternal, myNickname]);

  // 5-2. 방장 권한 수동 위임
  const transferHost = useCallback(
    async (targetNicknameId: string) => {
      if (!currentRoomId || !companyCode) return;
      const roomId = currentRoomId;
      const targetKey = toBattleKey(targetNicknameId);

      try {
        const snapshot = await get(ref(rtdb, roomPath(companyCode, roomId)));
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        const players = data.players || {};
        const targetPlayer = players[targetKey];
        if (!targetPlayer) return;

        await updateRoomAndLobby(companyCode, roomId, {
          hostNicknameId: targetPlayer.nicknameId,
          hostKey: targetKey,
          hostNickname: targetPlayer.nickname,
          [`players/${myKey}/isHost`]: false,
          [`players/${myKey}/isReady`]: false,
          [`players/${targetKey}/isHost`]: true,
          [`players/${targetKey}/isReady`]: true,
        });

        await push(
          ref(rtdb, `${roomPath(companyCode, roomId)}/messages`),
          systemMessage(`${myNickname}님이 ${targetPlayer.nickname}님에게 방장 권한을 위임했습니다.`)
        );
      } catch (err) {
        console.error("Failed to transfer host:", err);
      }
    },
    [companyCode, currentRoomId, myKey, myNickname]
  );

  // 5-3. 로비에서 방 삭제 (방장 전용 / 다른 참가자가 있으면 권한 위임 후 나만 나오기 or 전체 삭제)
  const deleteRoomFromLobby = useCallback(
    async (roomId: string, forceDeleteAll: boolean = false) => {
      if (!companyCode || !roomId) return;

      try {
        const snapshot = await get(ref(rtdb, roomPath(companyCode, roomId)));
        if (!snapshot.exists()) {
          // 방 본문이 이미 없으면 남은 로비 요약만 정리
          await remove(ref(rtdb, lobbyPath(companyCode, roomId))).catch(() => {});
          return;
        }
        const data = snapshot.val();
        const players = data.players || {};
        const remainingKeys = Object.keys(players).filter((k) => k !== myKey);

        if (remainingKeys.length === 0 || forceDeleteAll) {
          await removeRoomCompletely(companyCode, roomId, myKey);
        } else {
          await leaveRoomInternal(roomId, data, (nextHostNickname) =>
            nextHostNickname
              ? `개설자 ${myNickname}님이 방을 나가서 ${nextHostNickname}님에게 방장 권한이 위임되었습니다.`
              : `${myNickname}님이 퇴장했습니다.`
          );
        }
      } catch (err) {
        console.error("Failed to delete room from lobby:", err);
        onNotifyRef.current?.("방을 삭제할 권한이 없습니다.");
      }
    },
    [companyCode, leaveRoomInternal, myKey, myNickname]
  );


  // 6. 준비(READY) 토글
  const toggleReady = useCallback(async () => {
    if (!currentRoomId || !currentRoom) return;
    const me = currentRoom.players.find((p) => p.nicknameId === myNicknameId || p.nickname === myNickname);
    const isHost = me?.isHost || currentRoom.hostNicknameId === myNicknameId || currentRoom.hostNickname === myNickname;
    if (!me || isHost) return;

    const myPlayerRef = ref(
      rtdb,
      `battles/${companyCode}/rooms/${currentRoomId}/players/${myKey}`
    );
    await update(myPlayerRef, { isReady: !me.isReady });
  }, [companyCode, currentRoom, currentRoomId, myNickname, myNicknameId, myKey]);

  // 7. 식당 픽하기 (새 후보 등록 및 내 대표 픽 설정)
  const pickRestaurant = useCallback(
    async (restaurant: BattlePickedRestaurant) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myKey}`);
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
    [companyCode, currentRoom, currentRoomId, myNickname, myKey]
  );

  // 7-2. 기존 등록된 후보 중 하나를 내 대표 픽으로 설정
  const setMyPickedCandidate = useCallback(
    async (cand: BattleCandidate) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myKey}`);
      await update(myPlayerRef, {
        pickedRestaurant: {
          id: cand.restaurantId,
          name: cand.name,
          category: cand.category,
          zeroPay: cand.zeroPay,
        },
      });
    },
    [companyCode, currentRoom, currentRoomId, myKey]
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

      const myPlayerRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/players/${myKey}`);
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
    [companyCode, currentRoomId, myNickname, myKey]
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

  // 5-4. 게임 모드 변경 (방장 전용)
  const changeGameMode = useCallback(
    async (newMode: BattleGameMode) => {
      if (!currentRoomId || !currentRoom) return;
      const me = currentRoom.players.find(
        (p) => p.nicknameId === myNicknameId || p.nickname === myNickname
      );
      const isHost =
        me?.isHost ||
        currentRoom.hostNicknameId === myNicknameId ||
        currentRoom.hostNickname === myNickname;
      if (!isHost) return;

      const roomId = currentRoomId;
      const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

      const modeNames: Record<BattleGameMode, string> = {
        "speed-vote": "스피드 투표",
        "worldcup": "메뉴 월드컵",
        "roulette": "운명의 룰렛",
      };

      await updateRoomAndLobby(companyCode, roomId, { gameMode: newMode });

      const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);
      await push(messagesRef, {
        id: `sys-${Date.now()}`,
        senderNickname: "SYSTEM",
        content: `방장이 게임을 [${modeNames[newMode] || newMode}](으)로 변경했습니다.`,
        createdAt: new Date().toISOString(),
        isSystem: true,
      });
    },
    [companyCode, currentRoom, currentRoomId, myNickname, myNicknameId]
  );

  // 스피드 투표 결과 확정 공통 함수
  const finishSpeedVote = useCallback(
    async (roomId: string) => {
      const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);
      const snap = await get(roomRef);
      if (!snap.exists()) return;
      const currentData = snap.val();
      if (currentData.status !== "in-game") return;

      const currentVotes: Record<string, string> =
        currentData.voteState && typeof currentData.voteState.votes === "object"
          ? currentData.voteState.votes
          : {};
      const cands: BattleCandidate[] = Object.values(currentData.candidates || {});
      if (cands.length === 0) return;

      const counts: Record<string, number> = {};
      cands.forEach((c) => (counts[c.id] = 0));
      Object.values(currentVotes).forEach((candId) => {
        if (candId && counts[candId] !== undefined) counts[candId] = (counts[candId] || 0) + 1;
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

      await updateRoomAndLobby(companyCode, roomId, {
        status: "finished",
        result,
      });
    },
    [companyCode]
  );

  // 월드컵 경기 결과 처리 및 다음 경기 / 토너먼트 진행 / 종료
  const resolveWorldcupMatch = useCallback(
    async (roomId: string, matchStartedAt?: number) => {
      const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);
      const snap = await get(roomRef);
      if (!snap.exists()) return;
      const currentData = snap.val();
      if (currentData.status !== "in-game") return;

      const curMatch = currentData.worldcupMatch;
      if (!curMatch) return;
      // 특정 매치 시작시간이 주어졌는데 이미 다른 매치로 넘어갔다면 무시
      if (matchStartedAt && curMatch.startedAt !== matchStartedAt) return;
      if (curMatch.isResolving) return;

      // 중복 실행 방지 플래그 선점
      await update(ref(rtdb, `battles/${companyCode}/rooms/${roomId}/worldcupMatch`), {
        isResolving: true,
      });

      const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);

      const votesAObj = curMatch.votesA || {};
      const votesBObj = curMatch.votesB || {};
      const countA = Array.isArray(votesAObj) ? votesAObj.length : Object.keys(votesAObj).length;
      const countB = Array.isArray(votesBObj) ? votesBObj.length : Object.keys(votesBObj).length;

      const candA: BattleCandidate = curMatch.candidateA;
      const candB: BattleCandidate = curMatch.candidateB;
      const isFinal = Boolean(curMatch.isFinal);

      let winner: BattleCandidate | null = null;
      const isTie = countA === countB;

      if (isTie) {
        if (isFinal) {
          // 결승전 동점 -> 무승부로 최종 종료!
          await push(messagesRef, {
            id: `sys-${Date.now()}`,
            senderNickname: "SYSTEM",
            content: `[결승전 결과] [${candA.name}](${countA}표) vs [${candB.name}](${countB}표) - 치열한 접전 끝에 완벽한 무승부(동점)입니다! 두 메뉴 중 함께 잘 협의해보세요!`,
            createdAt: new Date().toISOString(),
            isSystem: true,
          });

          const result: BattleResult = {
            winner: candA, // 호환성 유지용 (isTie가 true이므로 tiedCandidates가 우선됨)
            gameMode: "worldcup",
            totalParticipants: Object.keys(currentData.players || {}).length,
            finishedAt: new Date().toISOString(),
            isTie: true,
            tiedCandidates: [candA, candB],
            tieMessage: "투표 결과가 동점입니다! 팀원들과 함께 맛있는 점심을 잘 협의해보세요.",
          };

          await updateRoomAndLobby(companyCode, roomId, {
            status: "finished",
            result,
          });
          return;
        } else {
          // 중간 경기 동점 -> 50:50 무작위 추첨으로 진출자 선정
          winner = Math.random() < 0.5 ? candA : candB;
          await push(messagesRef, {
            id: `sys-${Date.now()}`,
            senderNickname: "SYSTEM",
            content: `[${curMatch.roundName} 결과] [${candA.name}](${countA}표) vs [${candB.name}](${countB}표) 동점! 무작위 추첨으로 [${winner.name}]이(가) 다음 라운드에 진출합니다!`,
            createdAt: new Date().toISOString(),
            isSystem: true,
          });
        }
      } else {
        winner = countA > countB ? candA : candB;
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `[${curMatch.roundName} 결과] [${candA.name}](${countA}표) vs [${candB.name}](${countB}표) -> [${winner.name}] 승리!`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      }

      if (!winner) return;

      // 다음 라운드 진출 후보에 승자 추가
      const rawNext = Array.isArray(curMatch.nextRoundCandidates)
        ? curMatch.nextRoundCandidates
        : Object.values(curMatch.nextRoundCandidates || {});
      const nextRoundCandidates: BattleCandidate[] = [...rawNext, winner];

      // 현재 라운드에서 아직 경기 대기 중인 후보 목록
      const rawRemaining = Array.isArray(curMatch.remainingCandidates)
        ? curMatch.remainingCandidates
        : Object.values(curMatch.remainingCandidates || {});
      const remainingCandidates: BattleCandidate[] = [...rawRemaining];

      // Case 1: 현재 라운드에 2개 이상 후보가 남아있어 다음 매치 진행
      if (remainingCandidates.length >= 2) {
        const nextA = remainingCandidates[0];
        const nextB = remainingCandidates[1];
        const newRemaining = remainingCandidates.slice(2);

        // 만약 이번 라운드에 홀수라서 1명만 남게 된다면, 그 1명은 부전승으로 nextRoundCandidates에 미리 추가
        let byeCand: BattleCandidate | undefined = undefined;
        if (newRemaining.length === 1) {
          byeCand = newRemaining[0];
          nextRoundCandidates.push(byeCand);
          await push(messagesRef, {
            id: `sys-${Date.now()}`,
            senderNickname: "SYSTEM",
            content: `[부전승 안내] [${byeCand.name}]은(는) 부전승으로 다음 라운드에 직행합니다.`,
            createdAt: new Date().toISOString(),
            isSystem: true,
          });
        }

        const nextStartedAt = Date.now();
        const nextMatch: BattleWorldcupMatch = {
          matchIndex: (curMatch.matchIndex || 1) + 1,
          totalMatchesInRound: curMatch.totalMatchesInRound || 1,
          roundName: curMatch.roundName,
          candidateA: nextA,
          candidateB: nextB,
          votesA: {},
          votesB: {},
          durationSeconds: 60,
          startedAt: nextStartedAt,
          remainingCandidates: newRemaining.length === 1 ? [] : newRemaining,
          nextRoundCandidates,
          byeCandidate: byeCand,
          isFinal: false,
        };

        await updateRoomAndLobby(companyCode, roomId, {
          worldcupMatch: nextMatch,
        });

        setTimeout(() => {
          resolveWorldcupMatch(roomId, nextStartedAt);
        }, 60000);
        return;
      }

      // Case 2: 현재 라운드에 1명만 남은 경우 (부전승)
      if (remainingCandidates.length === 1) {
        const byeCand = remainingCandidates[0];
        nextRoundCandidates.push(byeCand);
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `[부전승 안내] [${byeCand.name}]은(는) 부전승으로 다음 라운드에 직행합니다.`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      }

      // Case 3: 현재 라운드의 모든 경기가 종료됨
      // 다음 라운드로 진출한 후보 수에 따라 판단
      if (nextRoundCandidates.length === 1) {
        // 단독 최종 우승자 탄생!
        const finalWinner = nextRoundCandidates[0];
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `[메뉴 월드컵 최종 우승] [${finalWinner.name}]! 오늘의 점심 메뉴로 결정되었습니다!`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });

        const result: BattleResult = {
          winner: finalWinner,
          gameMode: "worldcup",
          totalParticipants: Object.keys(currentData.players || {}).length,
          finishedAt: new Date().toISOString(),
          isTie: false,
        };

        await updateRoomAndLobby(companyCode, roomId, {
          status: "finished",
          result,
        });
        return;
      }

      // 다음 라운드 시작 (후보 2명 이상)
      const isNextFinal = nextRoundCandidates.length === 2;
      let nextRoundName = "";
      if (isNextFinal) {
        nextRoundName = "결승전";
      } else if (nextRoundCandidates.length <= 4) {
        nextRoundName = "준결승";
      } else if (nextRoundCandidates.length <= 8) {
        nextRoundName = "8강";
      } else {
        nextRoundName = `${nextRoundCandidates.length}강`;
      }

      const nextA = nextRoundCandidates[0];
      const nextB = nextRoundCandidates[1];
      const newRemaining = nextRoundCandidates.slice(2);

      let byeCand: BattleCandidate | undefined = undefined;
      const newNextRound: BattleCandidate[] = [];
      if (newRemaining.length === 1) {
        byeCand = newRemaining[0];
        newNextRound.push(byeCand);
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `[부전승 안내] [${byeCand.name}]은(는) 부전승으로 결승(다음 라운드)에 직행합니다.`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      }

      const totalMatches = isNextFinal ? 1 : Math.ceil(nextRoundCandidates.length / 2);
      const displayRoundName = isNextFinal
        ? "결승전"
        : `${nextRoundName} 1경기`;

      await push(messagesRef, {
        id: `sys-${Date.now()}`,
        senderNickname: "SYSTEM",
        content: `[${nextRoundName}] 대결이 시작되었습니다! (${nextA.name} vs ${nextB.name})`,
        createdAt: new Date().toISOString(),
        isSystem: true,
      });

      const nextStartedAt = Date.now();
      const nextMatch: BattleWorldcupMatch = {
        matchIndex: 1,
        totalMatchesInRound: totalMatches,
        roundName: displayRoundName,
        candidateA: nextA,
        candidateB: nextB,
        votesA: {},
        votesB: {},
        durationSeconds: 60,
        startedAt: nextStartedAt,
        remainingCandidates: newRemaining.length === 1 ? [] : newRemaining,
        nextRoundCandidates: newNextRound,
        byeCandidate: byeCand,
        isFinal: isNextFinal,
      };

      await updateRoomAndLobby(companyCode, roomId, {
        worldcupMatch: nextMatch,
      });

      setTimeout(() => {
        resolveWorldcupMatch(roomId, nextStartedAt);
      }, 60000);
    },
    [companyCode]
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

    const candidatesList: BattleCandidate[] = Array.isArray(currentRoom.candidates)
      ? (currentRoom.candidates as BattleCandidate[])
      : (Object.values(currentRoom.candidates || {}) as BattleCandidate[]);

    if (candidatesList.length < 2) {
      return { success: false, error: "메뉴 후보가 최소 2개 이상 등록되어야 합니다." };
    }

    const roomId = currentRoomId;
    const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);

    if (currentRoom.gameMode === "speed-vote") {
      // 참여형 게임 최대 60초(1분) 제한
      const voteState: BattleVoteState = {
        startedAt: Date.now(),
        durationSeconds: 60,
        votes: {},
      };
      await updateRoomAndLobby(companyCode, roomId, {
        status: "in-game",
        voteState,
      });

      // 60초 후 미투표 인원 제외하고 자동 확정 (만약 전원 조기 투표 시 즉시 종료됨)
      setTimeout(() => {
        finishSpeedVote(roomId);
      }, 60000);
    } else if (currentRoom.gameMode === "roulette") {
      const cands: BattleCandidate[] = Object.values(currentRoom.candidates || {});
      const winner = cands[Math.floor(Math.random() * cands.length)] || cands[0];
      const rouletteState = {
        startedAt: Date.now(),
        durationMs: 5000,
        winnerCandidateId: winner.id,
      };

      await updateRoomAndLobby(companyCode, roomId, {
        status: "in-game",
        rouletteState,
      });

      // 5초 동안 전원 동일한 원형 룰렛 스핀 애니메이션 후 결과 전환
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
        await updateRoomAndLobby(companyCode, roomId, {
          status: "finished",
          result,
        });
      }, 5000);
    } else if (currentRoom.gameMode === "worldcup") {
      const shuffled = [...candidatesList].sort(() => Math.random() - 0.5);
      const isFinal = shuffled.length === 2;

      let roundName = "";
      if (isFinal) {
        roundName = "결승전";
      } else if (shuffled.length <= 4) {
        roundName = "준결승 1경기";
      } else if (shuffled.length <= 8) {
        roundName = "8강 1경기";
      } else {
        roundName = `${shuffled.length}강 1경기`;
      }

      const candA = shuffled[0];
      const candB = shuffled[1];
      const remaining = shuffled.slice(2);
      const nextRoundCandidates: BattleCandidate[] = [];
      let byeCandidate: BattleCandidate | undefined = undefined;

      const messagesRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}/messages`);

      // 만약 홀수라서 마지막 1명이 남는 경우 (예: 3개일 때 shuffled[2] 부전승)
      if (remaining.length === 1) {
        byeCandidate = remaining[0];
        nextRoundCandidates.push(byeCandidate);
        await push(messagesRef, {
          id: `sys-${Date.now()}`,
          senderNickname: "SYSTEM",
          content: `[부전승 안내] [${byeCandidate.name}]은(는) 부전승으로 다음 라운드에 직행합니다.`,
          createdAt: new Date().toISOString(),
          isSystem: true,
        });
      }

      const startedAt = Date.now();
      const match: BattleWorldcupMatch = {
        matchIndex: 1,
        totalMatchesInRound: isFinal ? 1 : Math.ceil(shuffled.length / 2),
        roundName: isFinal ? "결승전" : roundName,
        candidateA: candA,
        candidateB: candB,
        votesA: {},
        votesB: {},
        durationSeconds: 60,
        startedAt,
        remainingCandidates: remaining.length === 1 ? [] : remaining,
        nextRoundCandidates,
        byeCandidate,
        isFinal,
      };

      await updateRoomAndLobby(companyCode, roomId, {
        status: "in-game",
        worldcupMatch: match,
      });

      await push(messagesRef, {
        id: `sys-${Date.now()}`,
        senderNickname: "SYSTEM",
        content: `메뉴 월드컵이 시작되었습니다! (${candA.name} vs ${candB.name})`,
        createdAt: new Date().toISOString(),
        isSystem: true,
      });

      // 60초 후 다수결 승자 판정 및 다음 매치 진행 (전원 투표 완료 시 조기 진행)
      setTimeout(() => {
        resolveWorldcupMatch(roomId, startedAt);
      }, 60000);
    }

    return { success: true };
  }, [companyCode, currentRoom, currentRoomId, finishSpeedVote, resolveWorldcupMatch, myNickname, myNicknameId]);

  // 11. 투표하기 (전원 참여 시 즉시 조기 종료 처리)
  const castVote = useCallback(
    async (candidateId: string) => {
      if (!currentRoomId || !currentRoom) return;
      const roomId = currentRoomId;

      if (currentRoom.gameMode === "speed-vote") {
        const voteRef = ref(
          rtdb,
          `battles/${companyCode}/rooms/${roomId}/voteState/votes/${myKey}`
        );
        await set(voteRef, candidateId);

        // 최신 투표 수 확인하여 방의 모든 플레이어가 참여했는지 체크
        const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);
        const snap = await get(roomRef);
        if (snap.exists()) {
          const data = snap.val();
          const playersCount = data.players ? Object.keys(data.players).length : 0;
          const votesCount = data.voteState?.votes ? Object.keys(data.voteState.votes).length : 0;

          if (playersCount > 0 && votesCount >= playersCount) {
            // 모든 참가자가 투표 완료했으므로 즉시 조기 종료
            await finishSpeedVote(roomId);
          }
        }
      } else if (currentRoom.gameMode === "worldcup" && currentRoom.worldcupMatch) {
        const match = currentRoom.worldcupMatch;
        const candAId = match.candidateA?.id;
        const candBId = match.candidateB?.id;

        if (candidateId === candAId) {
          const voteARef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesA/${myKey}`
          );
          const voteBRef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesB/${myKey}`
          );
          await set(voteARef, true);
          await remove(voteBRef);
        } else if (candidateId === candBId) {
          const voteARef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesA/${myKey}`
          );
          const voteBRef = ref(
            rtdb,
            `battles/${companyCode}/rooms/${roomId}/worldcupMatch/votesB/${myKey}`
          );
          await set(voteBRef, true);
          await remove(voteARef);
        }

        // 최신 월드컵 투표 수 확인
        const roomRef = ref(rtdb, `battles/${companyCode}/rooms/${roomId}`);
        const snap = await get(roomRef);
        if (snap.exists()) {
          const data = snap.val();
          const playersCount = data.players ? Object.keys(data.players).length : 0;
          const curMatch = data.worldcupMatch;
          const countA = curMatch?.votesA ? Object.keys(curMatch.votesA).length : 0;
          const countB = curMatch?.votesB ? Object.keys(curMatch.votesB).length : 0;

          if (playersCount > 0 && (countA + countB) >= playersCount) {
            // 모든 참가자가 투표 완료했으므로 즉시 다음 단계 진행
            await resolveWorldcupMatch(roomId, curMatch.startedAt);
          }
        }
      }
    },
    [companyCode, currentRoom, currentRoomId, finishSpeedVote, resolveWorldcupMatch, myKey]
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
            k === data.hostKey ||
            p.nicknameId === data.hostNicknameId;

          updatedPlayers[k] = {
            ...p,
            isReady: isHost ? true : false,
          };
        });

        await updateRoomAndLobby(companyCode, roomId, {
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
  };
}
