// 클릭 통계를 서버로 보내는 fire-and-forget 헬퍼. 통계 수집이 핵심 기능(지도/리스트) UX를
// 막으면 안 되므로 await하지 않고, 실패해도 조용히 무시한다.
export function logRestaurantClick(companyCode: string, restaurantId: string): void {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyCode, restaurantId, type: "click" }),
  }).catch(() => {
    // 통계 수집 실패는 무시 - 사용자에게 알릴 필요 없음.
  });
}
