// 실시간 배틀(RTDB)에서 사용자를 가리키는 키. RTDB 키에는 ". # $ [ ] /" 문자를 쓸 수 없으므로
// 닉네임 ID의 해당 문자(와 이스케이프 문자 "%")만 %XX 형태로 바꾼다. 한글 등 나머지 문자는 그대로 둔다.
// 서버(커스텀 토큰 클레임 bk)와 클라이언트(경로 키)가 반드시 같은 함수를 써야 보안 규칙이 맞는다.
export function toBattleKey(nicknameId: string): string {
  return nicknameId.replace(
    /[.#$[\]/%]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}

export function toBattleUid(companyCode: string, nicknameId: string): string {
  return `${companyCode}:${toBattleKey(nicknameId)}`;
}
