import { db } from "@/lib/firebase";

// 실시간 인기 Top3 위젯 + 필터바의 "최근많이찾는" 태그가 공유하는 집계 로직.
// 최근 POPULAR_WINDOW_HOURS 이내 클릭 이벤트를 restaurantId로 묶어 클릭 수 내림차순 정렬한다.
// events 컬렉션에서 type에 등호 필터를 추가로 걸면 createdAt 범위 필터와 합쳐져 복합 인덱스가
// 필요해지므로, createdAt 범위만 쿼리하고 type은 메모리에서 걸러낸다 (토이 프로젝트 규모라 충분).
const POPULAR_WINDOW_HOURS = 24;

export interface PopularEntry {
  restaurantId: string;
  clickCount: number;
}

// limit을 안 주면 집계된 전체를 클릭 수 내림차순으로 반환한다.
export async function getPopularEntries(
  companyCode: string,
  limit?: number
): Promise<PopularEntry[]> {
  const since = new Date(Date.now() - POPULAR_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("events")
    .where("createdAt", ">=", since)
    .get();

  const counts = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.type !== "click" || !data.restaurantId) continue;
    counts.set(data.restaurantId, (counts.get(data.restaurantId) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries())
    .map(([restaurantId, clickCount]) => ({ restaurantId, clickCount }))
    .sort((a, b) => b.clickCount - a.clickCount);

  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}
