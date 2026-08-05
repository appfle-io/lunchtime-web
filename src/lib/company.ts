// 회사코드는 대소문자 구분 없이 통과되게 하기 위해 항상 이 함수로 정규화(소문자+trim)해서 씀.
// Firestore에서도 companies 컬렉션의 문서ID를 이 정규화된 값으로 쓰기로 했음
// (companies/{normalizeCompanyCode(code)}) - 그러면 대소문자 무관하게 항상 같은 문서를 찾게 된다.
export function normalizeCompanyCode(code: string): string {
  return code.trim().toLowerCase();
}
