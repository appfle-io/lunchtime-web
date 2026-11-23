import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase";

// "최근 7일 동료들이 많이 간 식당" 집계.
// 밥 먹은 기록은 사람별 하위 컬렉션(companies/{code}/users/{nicknameId}/mealLogs)에 흩어져 있어서,
// 조회할 때마다 모으면 사람 수 x 기록 수만큼 읽게 된다. 그래서 기록을 추가/수정/삭제할 때
// companies/{code}/mealStats/{YYYY-MM-DD} 문서에 식당별 횟수를 더하고 빼 두고,
// 조회는 최근 7일 문서 7개만 읽는다 (조회수 통계 hourlyStats와 같은 방식).
// 목록에서 고른 식당(restaurantId가 있는 기록)만 센다. 직접 입력한 이름은 지도 식당과 연결할 수 없다.
const WINDOW_DAYS = 7;
const CACHE_TTL_MS = 2 * 60 * 1000;

export interface VisitEntry {
  restaurantId: string;
  visitCount: number;
}

const cache = new Map<string, { data: VisitEntry[]; expiresAt: number }>();

function statsRef(companyCode: string, date: string) {
  return db.collection("companies").doc(companyCode).collection("mealStats").doc(date);
}

/** 한국 시간 기준 오늘부터 거꾸로 days일의 "YYYY-MM-DD" 목록 */
export function recentKstDates(days: number): string[] {
  const kstNow = Date.now() + 9 * 60 * 60 * 1000;
  return Array.from({ length: days }, (_, i) => new Date(kstNow - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
}

/** 기록 한 건만큼 그날 집계를 바꾼다. 통계 실패가 기록 자체를 막지 않게 오류는 삼킨다. */
export async function adjustMealVisit(
  companyCode: string,
  date: string | null | undefined,
  restaurantId: string | null | undefined,
  delta: 1 | -1
): Promise<void> {
  if (!date || !restaurantId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || /[./]/.test(restaurantId)) return;
  try {
    await statsRef(companyCode, date).set({ counts: { [restaurantId]: FieldValue.increment(delta) } }, { merge: true });
    cache.delete(companyCode);
  } catch (err) {
    console.warn("[meal-stats] 집계 갱신 실패:", err);
  }
}

/** 최근 7일 많이 간 순서. 집계가 생기기 전 기록을 지운 경우 음수가 될 수 있어 0 이하는 뺀다. */
export async function getRecentVisits(companyCode: string): Promise<VisitEntry[]> {
  const cached = cache.get(companyCode);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const snaps = await db.getAll(...recentKstDates(WINDOW_DAYS).map((d) => statsRef(companyCode, d)));
  const counts = new Map<string, number>();
  for (const snap of snaps) {
    const c = snap.data()?.counts as Record<string, number> | undefined;
    if (!c) continue;
    for (const [id, n] of Object.entries(c)) counts.set(id, (counts.get(id) ?? 0) + Number(n));
  }
  const data = Array.from(counts.entries())
    .filter(([, n]) => n > 0)
    .map(([restaurantId, visitCount]) => ({ restaurantId, visitCount }))
    .sort((a, b) => b.visitCount - a.visitCount);
  cache.set(companyCode, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
