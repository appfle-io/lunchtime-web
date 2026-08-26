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
  roundName: string; // e.g. "8강 1경기", "4강 1경기", "결승"
  candidateA: BattleCandidate;
  candidateB: BattleCandidate;
  votesA: string[]; // nicknameIds
  votesB: string[]; // nicknameIds
  durationSeconds: number;
  startedAt: number;
}

export interface BattleRouletteState {
  startedAt: number;
  durationMs: number;
  winnerCandidateId: string;
}

export interface BattleResult {
  winner: BattleCandidate;
  gameMode: BattleGameMode;
  totalParticipants: number;
  finishedAt: string;
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
