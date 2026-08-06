import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase";

// 지금은 클릭 이벤트만 수집한다 (검색 UI가 아직 없어서 검색 이벤트는 검색창이 생기면 추가하기로 함).
export type AnalyticsEventType = "click";

// 2026-08-06: companies/{code}/events에 원본 이벤트를 낱개로 쌓아두고, 조회할 때마다(getPopularEntries)
// "최근 24시간 이벤트 전체"를 다시 스캔하던 방식을 버렸다. 클릭이 쌓일수록(트래픽이 늘수록) 조회 1번의
// 읍기 비용이 계속 커지는 구조였기 때문. 대신 companies/{code}/hourlyStats/{hourKey} 문서에 식당별
// 클릭 수만 누적(increment)해두고, 조회는 그 집계 문서만 합산한다(popular-server.ts 참고) - 조회 비용이
// 트래픽과 무관하게 "최근 24시간 = 최대 24개 문서"로 고정된다.
function hourKey(date: Date): string {
  // UTC 기준 "YYYYMMDDHH". createdAt에 쓰던 toISOString()과 같은 기준(UTC)으로 맞춰서 시간대 혼선을 피한다.
  return date.toISOString().slice(0, 13).replace(/[-T]/g, "");
}

export async function logRestaurantEvent(
  companyCode: string,
  restaurantId: string,
  type: AnalyticsEventType
): Promise<void> {
  const key = hourKey(new Date());
  await db
    .collection("companies")
    .doc(companyCode)
    .collection("hourlyStats")
    .doc(key)
    .set({ counts: { [restaurantId]: FieldValue.increment(1) } }, { merge: true });
}
