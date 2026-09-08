export type BattleGameMode = "speed-vote" | "worldcup" | "roulette";

export type BattleRoomStatus = "waiting" | "in-game" | "finished";

export interface BattlePickedRestaurant {
  id?: string;
  name: string;
  category?: string;
  roadAddress?: string;
  zeroPay?: boolean;
}

export interface BattlePlayer {
  socketId: string;
  nicknameId: string;
  nickname: string;
  isHost: boolean;
  isReady: boolean;
  slotIndex: number;
  pickedRestaurant?: BattlePickedRestaurant;
}

export interface BattleChatMessage {
  id: string;
  senderNickname: string;
  content: string;
  createdAt: string;
  isSystem?: boolean;
}

export interface BattleCandidate {
  id: string;
  name: string;
  category?: string;
  addedByNickname: string;
  restaurantId?: string;
  zeroPay?: boolean;
}

export interface BattleVoteState {
  startedAt: number;
  durationSeconds: number;
  votes: Record<string, string>; // nicknameId -> candidateId
}

export interface BattleWorldcupMatch {
  matchIndex: number;
  totalMatchesInRound?: number;
  roundName: string; // e.g. "8강 1경기", "준결승", "결승전"
  candidateA: BattleCandidate;
  candidateB: BattleCandidate;
  votesA: Record<string, boolean> | string[]; // nicknameIds
  votesB: Record<string, boolean> | string[]; // nicknameIds
  durationSeconds: number;
  startedAt: number;
  remainingCandidates?: BattleCandidate[]; // 현재 라운드에서 경기 대기 중인 후보들
  nextRoundCandidates?: BattleCandidate[]; // 다음 라운드 진출 확정된 후보들
  byeCandidate?: BattleCandidate; // 현재 라운드 부전승 진출 후보
  isFinal?: boolean; // 결승전 여부
}

export interface BattleRouletteState {
  startedAt: number;
  durationMs: number;
  winnerCandidateId: string;
}

export interface BattleResult {
  winner?: BattleCandidate;
  gameMode: BattleGameMode;
  totalParticipants: number;
  finishedAt: string;
  isTie?: boolean;
  tiedCandidates?: BattleCandidate[];
  tieMessage?: string;
}

export interface BattleRoomSummary {
  id: string;
  title: string;
  companyCode: string;
  hostNickname: string;
  hasPassword: boolean;
  maxPlayers: number;
  playerCount: number;
  gameMode: BattleGameMode;
  status: BattleRoomStatus;
  createdAt: number;
}

export interface BattleRoomDetail {
  id: string;
  title: string;
  companyCode: string;
  hostNicknameId: string;
  hostNickname: string;
  hasPassword: boolean;
  maxPlayers: number;
  gameMode: BattleGameMode;
  status: BattleRoomStatus;
  players: BattlePlayer[];
  candidates: BattleCandidate[];
  messages: BattleChatMessage[];
  voteState?: BattleVoteState;
  worldcupMatch?: BattleWorldcupMatch;
  rouletteState?: BattleRouletteState;
  result?: BattleResult;
  createdAt: number;
}
