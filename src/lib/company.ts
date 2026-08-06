// 회사코드는 대소문자 구분 없이 통과되게 하기 위해 항상 이 함수로 정규화(소문자+trim)해서 씀.
// Firestore에서도 companies 컬렉션의 문서ID를 이 정규화된 값으로 쓰기로 했음
// (companies/{normalizeCompanyCode(code)}) - 그러면 대소문자 무관하게 항상 같은 문서를 찾게 된다.
// 주의: 이 파일은 클라이언트 컴포넌트(app/page.tsx)에서도 import되문다. firebase-admin도 여기서 import하면 번들러서 깨진다.
// Firestore 조회가 필요하면 lib/company-server.ts에 추가할 것.
export function normalizeCompanyCode(code: string): string {
  return code.trim().toLowerCase();
}
