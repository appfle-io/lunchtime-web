import { FieldValue, type Query } from "firebase-admin/firestore";
import { db } from "@/lib/firebase";
import type {
  MiniGameParticipant,
  MiniGameRankingEntry,
  MiniGameResult,
  MiniGameTeam,
  MiniGameType,
} from "@/types";

function miniGamesRef(companyCode: string) {
  return db.collection("companies").doc(companyCode).collection("miniGames");
}

function statsOverallDocRef(companyCode: string) {
  return db.collection("companies").doc(companyCode).collection("stats").doc("minigame_overall");
}

const RANKING_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const rankingCache = new Map<string, { data: MiniGameRankingEntry[]; expiresAt: number }>();

export function invalidateMiniGameRankingCache(companyCode: string): void {
  rankingCache.delete(`${companyCode}:week`);
  rankingCache.delete(`${companyCode}:month`);
  rankingCache.delete(`${companyCode}:all`);
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

  // 2026-08-25 최적화: 종합 랭킹을 1 Read로 조회할 수 있도록 누적 통계 문서 갱신
  if (input.winners && input.winners.length > 0) {
    const statsUpdates: Record<string, unknown> = {};
    for (const w of input.winners) {
      if (w.nicknameId) {
        statsUpdates[`users.${w.nicknameId}.winCount`] = FieldValue.increment(1);
        statsUpdates[`users.${w.nicknameId}.nickname`] = w.name;
      }
    }
    if (Object.keys(statsUpdates).length > 0) {
      statsOverallDocRef(companyCode)
        .set(statsUpdates, { merge: true })
        .catch(() => {});
    }
  }

  // 랭킹 캐시 즉시 무효화 (실시간 반영 보장)
  invalidateMiniGameRankingCache(companyCode);

  return { id: docRef.id, ...doc } as MiniGameResult;
}

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

export async function getMiniGameRanking(
  companyCode: string,
  period: MiniGameRankingPeriod
): Promise<MiniGameRankingEntry[]> {
  const cacheKey = `${companyCode}:${period}`;
  const cached = rankingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // 2026-08-25 최적화: 종합(all) 랭킹은 누적 집계 문서 1개(1 Read)만 읽는다
  if (period === "all") {
    try {
      const statsSnap = await statsOverallDocRef(companyCode).get();
      if (statsSnap.exists) {
        const data = statsSnap.data();
        const users = (data?.users ?? {}) as Record<string, { winCount?: number; nickname?: string }>;
        const result: MiniGameRankingEntry[] = Object.entries(users)
          .map(([nicknameId, v]) => ({
            nicknameId,
            nickname: v.nickname ?? nicknameId,
            winCount: typeof v.winCount === "number" ? v.winCount : 0,
          }))
          .filter((entry) => entry.winCount > 0)
          .sort((a, b) => b.winCount - a.winCount)
          .slice(0, 50);

        rankingCache.set(cacheKey, { data: result, expiresAt: Date.now() + RANKING_CACHE_TTL_MS });
        return result;
      }
    } catch {
      // 누적 문서 조회 실패 시 아래 기존 쿼리로 폴백
    }
  }

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
    winners.forEach((w) => {
      if (!w.nicknameId) return;
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
