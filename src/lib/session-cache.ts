// 2026-08-11 신규(페이지 로드 캐싱 2차 개선): 브라우저 sessionStorage에 TTL과 함께 값을
// 저장해두는 아주 작은 헬퍼. 새로고침(F5)해도 sessionStorage는 그대로 유지되므로, 같은 탭에서
// TTL 안에 다시 페이지를 열면 fetch를 아예 보내지 않고 캐시된 값을 바로 쓸 수 있다
// (사용자가 요청한 "데이터를 저장해두고 읽어오는 방식"에 해당).
//
// localStorage 대신 sessionStorage를 쓰는 이유: 탭을 닫으면 사라져서, 아주 오래 방치된 값을
// 계속 보여줄 위험이 적다. companyUsers/popular처럼 "몇 분~1분 정도만 아끼면 되는" 데이터에는
// 이 정도 수명이 딱 맞는다.
//
// 쿠키를 안 쓰는 이유: 쿠키는 매 HTTP 요청마다 서버로 같이 전송돼서(서버가 필요로 하지도 않는
// 데이터인데) 오히려 오버헤드가 붙고, 용량도 4KB 남짓으로 제한적이다. 여기서 캐싱하려는 값은
// 서버 인증/식별과 무관한 "그냥 화면에 다시 보여줄 데이터"라서 sessionStorage가 더 적합하다.
//
// 시크릿 모드/스토리지 차단 등으로 sessionStorage 접근 자체가 막혀 있어도(throw) 캐시 없이 매번
// 새로 불러오는 것과 동일하게 동작하도록 전부 try/catch로 감싼다 - 캐시는 있으면 좋은 최적화일
// 뿐, 실패해도 기능이 깨지면 안 된다.

interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

export function readSessionCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.savedAt !== "number" || Date.now() - entry.savedAt > ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { savedAt: Date.now(), data };
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // 저장 실패(용량 초과, 시크릿모드 등)는 조용히 무시 - 캐시 없이 동작하는 것과 같다.
  }
}
