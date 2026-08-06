import { db } from "@/lib/firebase";

// 실시간 인기 Top3 위젯 + 필터바의 "최근많이찾는" 태그가 공유하는 집계 로직.
// 2026-08-06: companies/{code}/events 컬렉션을 매번 통째로 다시 스캔하던 방식에서, companies/{code}/hourlyStats/{hourKey}
// 시간별 집계 문서를 합산하는 방식으로 바꿨다(analytics-server.ts 참고). 트래픽이 얼마나 늘어도 조회 비용이
// "최근 24시간 = 최대 24개 문서"로 고정된다 - 예전엔 24시간 안에 쌓인 클릭 이벤트 개수만큼 매번 다시 읍었다.
const POPULAR_WINDOW_HOURS = 24;

export interface PopularEntry {
  restaurantId: string;
  clickCount: number;
}

function hourKey(date: Date): string {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, "");
}

// 지금 시각 기준으로 최근 hours시간에 해당하는 hourKey 목록 (예: ["2026080610", "2026080609", ...]).
function recentHourKeys(hours: number): string[] {
  const now = Date.now();
  return Array.from({ length: hours }, (_, i) => hourKey(new Date(now - i * 60 * 60 * 1000)));
}

// limit을 안 주면 집계된 전체를 클릭 수 내림차순으로 반환한다.
export async function getPopularEntries(
  companyCode: string,
  limit?: number
): Promise<PopularEntry[]> {
  const refs = recentHourKeys(POPULAR_WINDOW_HOURS).map((key) =>
    db.collection("companies").doc(companyCode).collection("hourlyStats").doc(key)
  );

  const snapshots = await db.getAll(...refs);

  const counts = new Map<string, number>();
  for (const snap of snapshots) {
    const data = snap.data();
    if (!data?.counts) continue;
    for (const [restaurantId, count] of Object.entries(data.counts as Record<string, number>)) {
      counts.set(restaurantId, (counts.get(restaurantId) ?? 0) + count);
    }
  }

  const sorted = Array.from(counts.entries())
    .map(([restaurantId, clickCount]) => ({ restaurantId, clickCount }))
    .sort((a, b) => b.clickCount - a.clickCount);

  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}
