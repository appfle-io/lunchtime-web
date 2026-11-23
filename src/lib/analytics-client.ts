// 식당 조회 통계를 서버로 보내는 fire-and-forget 헬퍼. 통계 수집이 핵심 기능(지도/리스트) UX를
// 막으면 안 되므로 await하지 않고, 실패해도 조용히 무시한다.
// (서버 /api/events는 같은 회사 로그인 세션이 있을 때만 기록한다.)
//
// "지금 많이 보는 식당"이 사람 수에 가깝게 되도록, 같은 사람이 같은 식당을 하루에 여러 번 열어도
// 한 번만 보낸다 (예전엔 1분만 지나면 다시 세서 한 사람이 순위를 만들 수 있었다).
// 기기·브라우저가 바뀌면 다시 셀 수 있지만, 이 정도 정확도면 충분하다.
const STORAGE_KEY = "lt:viewedToday";
const memorySeen = new Set<string>(); // localStorage를 못 쓰는 환경(사생활 보호 모드 등)용

function todayKey(): string {
  // 한국 시간 기준 날짜
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function alreadyLoggedToday(key: string): boolean {
  const today = todayKey();
  if (memorySeen.has(`${today}:${key}`)) return true;
  memorySeen.add(`${today}:${key}`);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as { date: string; ids: string[] }) : null;
    const ids = saved?.date === today ? saved.ids : [];
    if (ids.includes(key)) return true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, ids: [...ids, key].slice(-500) }));
  } catch {
    // 저장소를 못 쓰면 메모리 기준으로만 막는다.
  }
  return false;
}

export function logRestaurantClick(companyCode: string, restaurantId: string): void {
  // 로컬 개발 서버도 운영 Firebase를 쓰므로, 개발 중에 연 식당이 운영 순위에 섞이지 않게 한다.
  if (process.env.NODE_ENV !== "production") return;
  if (alreadyLoggedToday(`${companyCode}:${restaurantId}`)) return;

  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyCode, restaurantId, type: "click" }),
  }).catch(() => {
    // 통계 수집 실패는 무시 - 사용자에게 알릴 필요 없음.
  });
}
