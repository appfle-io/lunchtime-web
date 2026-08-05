// 최초 계정 생성 시 보여줄 랜덤 닉네임 후보 생성기.
// "형용사/기분 + 음식명" 조합으로 캐주얼하고 재밌는 닉네임을 제안하고,
// 사용자는 그대로 쓰거나 직접 수정하거나 "다시 추천"으로 재생성할 수 있게 한다.
// 유일성 체크는 API 라우트에서 companyId 스코프로 별도 수행 (이 파일은 후보 생성만 담당).

const MOODS = [
  "든든한",
  "칼칼한",
  "든든배부른",
  "느긋한",
  "바삭한",
  "포근한",
  "쫄깃한",
  "산뜻한",
  "든든충전",
  "혼밥러",
];

const FOODS = [
  "제육왕",
  "칼국수러버",
  "돈까스단골",
  "김치찌개파",
  "냉면매니아",
  "국밥부심",
  "떡볶이덕후",
  "회오리감자",
  "삼겹살마스터",
  "샐러드파",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateNicknameCandidate(): string {
  return `${pick(MOODS)} ${pick(FOODS)}`;
}

export function generateNicknameCandidates(count = 3): string[] {
  const set = new Set<string>();
  // 중복 없이 count개 뽑히도록 시도 (조합 수가 적으므로 무한루프 방지용 상한)
  let guard = count * 10;
  while (set.size < count && guard-- > 0) {
    set.add(generateNicknameCandidate());
  }
  return Array.from(set);
}

/**
 * Firestore 문서ID로 쓸 수 있도록 닉네임을 정규화한다 (소문자, 공백→하이픈).
 * companies/{companyId}/users/{이 값} 을 문서ID로 써서, 문서 생성 자체가 유일성 체크 역할을 하게 한다.
 */
export function toNicknameId(nickname: string): string {
  return nickname.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * 닉네임이 이미 회사 내에 존재하면(정규화된 ID 기준) 숫자 접미사를 붙여 유일하게 만든다.
 * existingNicknameIds는 호출부(API 라우트)에서 Firestore 조회 후 전달하는 "정규화된 ID" 집합.
 */
export function resolveUniqueNickname(desired: string, existingNicknameIds: Set<string>): string {
  if (!existingNicknameIds.has(toNicknameId(desired))) return desired;
  let suffix = 2;
  let candidate = `${desired}_${suffix}`;
  while (existingNicknameIds.has(toNicknameId(candidate))) {
    suffix += 1;
    candidate = `${desired}_${suffix}`;
  }
  return candidate;
}
