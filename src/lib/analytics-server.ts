import { db } from "@/lib/firebase";

// 지금은 클릭 이벤트만 수집한다 (검색 UI가 아직 없어서 검색 이벤트는 검색창이 생기면 추가하기로 함).
export type AnalyticsEventType = "click";

// companies/{code}/events에 이벤트 원본을 그냥 쌓아둔다. 토이 프로젝트 규모(하루 수백~수천 건 수준)에서는
// 조회 시점에 집계해도 충분해서, 별도 롤업 컬렉션은 아직 만들지 않았다.
// 나중에 트래픽이 늘어나면 companies/{code}/hourlyStats/{hourKey} 같은 집계 문서로 전환하는 걸 고려할 것.
export async function logRestaurantEvent(
  companyCode: string,
  restaurantId: string,
  type: AnalyticsEventType
): Promise<void> {
  await db.collection("companies").doc(companyCode).collection("events").add({
    restaurantId,
    type,
    createdAt: new Date().toISOString(),
  });
}
