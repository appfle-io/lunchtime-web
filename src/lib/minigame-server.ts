import { db } from "@/lib/firebase";
import type { Query } from "firebase-admin/firestore";
import type {
  MiniGameParticipant,
  MiniGameRankingEntry,
  MiniGameResult,
  MiniGameTeam,
  MiniGameType,
} from "@/types";

// 2026-08-12 신규: 미니게임(제비뽑기/룰렛/사다리타기/팀나누기) 결과 저장 + 랭킹 집계.
// 진행 자체(누가 어떤 라운드에 뭘 냈는지 등)는 전부 클라이언트 로직으로 끝나고, 서버에는
// "끝난 결과" 1건만 저장한다 - vote-server.ts 등과 달리 여러 사람이 실시간으로 나눠서 진행하는
// 게임이 아니라 한 사람 폰에서 진행이 끝나기 때문에 서버 부하가 훨씬 적다.
function miniGamesRef(companyCode: string) {
  return db.collection("companies").doc(companyCode).collection("miniGames");
}

export async function saveMiniGameResult(
  companyCode: string,
  input: {
    type: MiniGameType;
    winnerCount?: number;
    winners?: MiniGameParticipant[];
    teamCount?: number;
    teams?: MiniGameTeam[];
    leftover?: MiniGameParticipant[];
    participants: MiniGameParticipant[];
    createdByNicknameId: string;
    createdByNickname: string;
  }
): Promise<MiniGameResult> {
  const createdAt = new Date().toISOString();
  // Firestore는 undefined 필드를 거부하므로(vote-server.ts의 addVoteOption과 동일한 이유),
  // 값이 있을 때만 필드를 넣도록 spread로 조립한다.
  const doc = {
    type: input.type,
    participants: input.participants,
    createdByNicknameId: input.createdByNicknameId,
    createdByNickname: input.createdByNickname,
    createdAt,
    ...(input.winnerCount !== undefined ? { winnerCount: input.winnerCount } : {}),
    ...(input.winners ? { winners: input.winners } : {}),
    ...(input.teamCount !== undefined ? { teamCount: input.teamCount } : {}),
    ...(input.teams ? { teams: input.teams } : {}),
    ...(input.leftover ? { leftover: input.leftover } : {}),
  };

  const docRef = await miniGamesRef(companyCode).add(doc);
  return { id: docRef.id, ...doc } as MiniGameResult;
}

// 랭킹 조회 결과를 짧게 캐시한다(popular-server.ts와 동일한 패턴) - 여러 명이 랭킹 화면을
// 자주 열어도 매번 전체를 다시 훑지 않게 하기 위함.
const RANKING_CACHE_TTL_MS = 60 * 1000;
const rankingCache = new Map<string, { data: MiniGameRankingEntry[]; expiresAt: number }>();

function startOfWeekISO(): string {
  const now = new Date();
  const day = now.getDay(); // 0(일)~6(토)
  const diffToMonday = (day + 6) % 7; // 이번 주 월요일까지 며칠 전인지
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

function startOfMonthISO(): string {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return first.toISOString();
}

export type MiniGameRankingPeriod = "week" | "month" | "all";

// 주간/월간은 createdAt range 쿼리(필드 1개짜리라 복합 인덱스 불필요, vote-server.ts와 동일
// 방침)로 좁혀서 가져온 뒤 메모리에서 집계한다. 종합(all)은 기간 제한이 없어 컬렉션 전체를
// 가져오는데, 토이 프로젝트 규모(회사당 하루 몇 건 수준)에서는 전체 스캔도 부담이 없고 여기에
// 캐시까지 더해 반복 조회 비용을 낮춘다 - 나중에 게임 수가 크게 늘면(수천 건 이상) 누적 카운터
// 문서 방식으로 바꾸는 걸 고려하면 된다.
export async function getMiniGameRanking(
  companyCode: string,
  period: MiniGameRankingPeriod
): Promise<MiniGameRankingEntry[]> {
  const cacheKey = `${companyCode}:${period}`;
  const cached = rankingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  let query: Query = miniGamesRef(companyCode);
  if (period === "week") {
    query = query.where("createdAt", ">=", startOfWeekISO());
  } else if (period === "month") {
    query = query.where("createdAt", ">=", startOfMonthISO());
  }

  const snapshot = await query.get();
  const counts = new Map<string, { nickname: string; count: number }>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const winners: MiniGameParticipant[] = data.winners ?? [];
    // 팀나누기(type: "teams")는 winners 필드가 아예 없어서 이 루프가 자동으로 건너뛴다 -
    // 당첨 개념이 없는 게임은 랭킹 집계 대상이 아니다(설계 문서 참고).
    winners.forEach((w) => {
      if (!w.nicknameId) return; // 게스트(수기입력)는 동명이인 구분이 안 돼서 랭킹에서 제외
      const entry = counts.get(w.nicknameId);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(w.nicknameId, { nickname: w.name, count: 1 });
      }
    });
  });

  const result: MiniGameRankingEntry[] = Array.from(counts.entries())
    .map(([nicknameId, v]) => ({ nicknameId, nickname: v.nickname, winCount: v.count }))
    .sort((a, b) => b.winCount - a.winCount)
    .slice(0, 50);

  rankingCache.set(cacheKey, { data: result, expiresAt: Date.now() + RANKING_CACHE_TTL_MS });
  return result;
}
