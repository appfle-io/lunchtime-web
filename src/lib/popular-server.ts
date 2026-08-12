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

// 2026-08-11 신규(페이지 로드 캐싱 2차 개선): getPopularEntries()는 companyCode당 최대 24개의
// hourlyStats 문서를 매번 getAll로 읍는다. 예전엔 CompanyHome 마운트(페이지 진입/새로고침)마다
// 캐시 없이 매번 이 24건 읍기가 나갔다 - 인기 순위는 몇십 초 안에 바뀌어도 체감상 문제없는
// 데이터라, restaurantsCache와 같은 짧은 TTL 인메모리 캐시를 적용한다. limit이 달라도 정렬된
// 전체 목록 자체는 같으므로, limit별로 따로 캐시하지 않고 companyCode 하나로만 캐시해서
// slice는 매번 요청받은 limit대로 적용한다.
const POPULAR_CACHE_TTL_MS = 30_000;
const popularCache = new Map<string, { data: PopularEntry[]; expiresAt: number }>();

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
  const cached = popularCache.get(companyCode);
  let sorted: PopularEntry[];

  if (cached && cached.expiresAt > Date.now()) {
    sorted = cached.data;
  } else {
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

    sorted = Array.from(counts.entries())
      .map(([restaurantId, clickCount]) => ({ restaurantId, clickCount }))
      .sort((a, b) => b.clickCount - a.clickCount);

    popularCache.set(companyCode, { data: sorted, expiresAt: Date.now() + POPULAR_CACHE_TTL_MS });
  }

  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}
