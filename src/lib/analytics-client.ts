// 클릭 통계를 서버로 보내는 fire-and-forget 헬퍼. 통계 수집이 핵심 기능(지도/리스트) UX를
// 막으면 안 되므로 await하지 않고, 실패해도 조용히 무시한다.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): /api/events는 익명 집계용이라 세션 체크가
// 없고, 같은 식당을 짧은 시간 안에 여러 번 클릭하면(더블클릭, 빠르게 연속 클릭 등) 그만큼
// hourlyStats 문서에 increment write가 쌓였다. 서버가 세션 없이 받는 구조는 그대로 두고,
// 클라이언트에서 "같은 식당은 DEBOUNCE_MS 안에는 한 번만 보낸다"는 디바운스를 추가했다 -
// 정상적인 사용 패턴에서 발생하는 중복 호출만 줄이는 목적이라 이 정도로 충분하다(약의도적으로
// API를 반복 호출하는 어뷰징까지 막으려면 서버 쪽 인증/레이트리밋이 필요하지만, 이 프로젝트
// 규모에선 과한 대응으로 보류).
const DEBOUNCE_MS = 60_000;
const lastLoggedAt = new Map<string, number>();

export function logRestaurantClick(companyCode: string, restaurantId: string): void {
  const key = `${companyCode}:${restaurantId}`;
  const now = Date.now();
  const last = lastLoggedAt.get(key);
  if (last && now - last < DEBOUNCE_MS) return;
  lastLoggedAt.set(key, now);

  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyCode, restaurantId, type: "click" }),
  }).catch(() => {
    // 통계 수집 실패는 무시 - 사용자에게 알릴 필요 없음.
  });
}
