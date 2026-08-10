// 네이버 지역검색이 내려주는 category 문자열(예: "음식점>한식>백반,죽")을 보고
// 마커에 쓸 이모지/색상/표시라벨을 결정한다.
//
// 2026-08-07 추가: 정부 공공데이터(소상공인시장진흥공단 상가정보)로 시딩한 식당은 업종 텍스트
// 자체가 뭉뚱그려져 있는 경우가 많다(갈비집도 그냥 "한식음식점"으로만 등록되거나, "기타 간이
// 음식점" 같은 진짜 뭉뚱그린 업종으로 등록된 곳도 많음) - 그래서 이 파일의 키워드 정규식만으로는
// 한계가 있다. 이걸 보완하기 위해 scripts/classify-categories-ai.ts가 Gemini로 식당 이름+원본
// 업종 텍스트를 보고 아래 CATEGORY_LABELS 중 하나로 재분류해서 Firestore의 categoryLabel
// 필드에 저장해둔다. getCategoryVisual()은 categoryLabel이 있으면 그걸 최우선으로 신뢰하고,
// 없을 때만 기존처럼 category 원본 텍스트를 정규식으로 추론한다 - 원본 category는 그대로 두고
// "보강"만 하는 방식이라 안전하게 되돌릴 수 있다.
//
// 2026-08-07 정규식 대폭 확장: 공공데이터 업종 코드 용어 추가.
// 소상공인시장진흥공단 상가정보의 상권업종중분류명/소분류명은 네이버 지역검색과 다른
// 행정 용어를 쓴다 (예: 카페 → "커피숍", 고기집 → "육류요리전문점", 치킨집 → "치킨전문점").
// AI 분류 스크립트 없이도 정규식만으로 "기타"를 최소화하기 위해 이 용어들을 추가한다.
export interface CategoryVisual {
  emoji: string;
  color: string;
  label: string;
}

const RULES: { test: RegExp; visual: CategoryVisual }[] = [
  {
    // 네이버: 한식, 백반, 국밥 등 / 공공데이터: 한식음식점, 일반음식점(한식 계열)
    test: /한식|백반|국밥|찌개|한정식|해장국|감자탕|설렁탕|곰탕|매운탕|추어탕|순두부|한식음식점|낙지|해물요리|복어/,
    visual: { emoji: "🍚", color: "#F59E0B", label: "한식" },
  },
  {
    // 네이버: 중식 계열 / 공공데이터: 중국음식, 중국음식점
    test: /중식|중국음식|중화요리|짜장|짬뽕|딤섬|양꼬치/,
    visual: { emoji: "🥡", color: "#EF4444", label: "중식" },
  },
  {
    // 네이버: 일식 계열 / 공공데이터: 일식음식, 일식음식점, 돈까스(일식 계열), 이자카야
    test: /일식|돈부리|라멘|스시|초밥|이자카야|돈까스|우동|사시미|덮밥|규동|일식음식/,
    visual: { emoji: "🍣", color: "#3B82F6", label: "일식" },
  },
  {
    // 네이버: 양식 계열 / 공공데이터: 서양음식, 패스트푸드, 경양식
    test: /양식|이탈리아|스테이크|파스타|버거|피자|리조또|브런치|서양음식|패스트푸드|경양식|햄버거/,
    visual: { emoji: "🍔", color: "#8B5CF6", label: "양식" },
  },
  {
    // 네이버: 카페, 디저트 / 공공데이터: 커피숍, 커피전문점, 제과점영업, 아이스크림
    test: /카페|디저트|베이커리|빵|커피숍|커피전문점|제과점|제과|아이스크림|빙수|다방/,
    visual: { emoji: "☕", color: "#92400E", label: "카페" },
  },
  {
    // 네이버: 치킨 / 공공데이터: 치킨전문점, 통닭
    // 호프/통닭에서 "통닭"은 치킨으로 우선 분류 (호프/주점 룰보다 먼저 선언)
    test: /치킨|치킨전문점|통닭/,
    visual: { emoji: "🍗", color: "#F97316", label: "치킨" },
  },
  {
    // 네이버: 육류, 고기 / 공공데이터: 육류요리전문점, 삼겹살, 돼지갈비, 한우 등
    // 보쌈/족발처럼 정육 위주 메뉴도 여기 포함.
    test: /육류|고기|갈비|삼겹살|목살|항정살|곱창|막창|정육|숯불구이|보쌈|족발|우삼겹|한우|육류요리전문점|돼지갈비|오리구이|닭갈비/,
    visual: { emoji: "🥩", color: "#B91C1C", label: "고기" },
  },
  {
    // 네이버: 분식 / 공공데이터: 분식 및 김밥전문점
    test: /분식|떡볶이|김밥|순대|어묵/,
    visual: { emoji: "🍢", color: "#DB2777", label: "분식" },
  },
  {
    // 네이버: 면류 / 공공데이터: 냉면집, 칼국수 등
    test: /국수|칼국수|냉면|쌀국수|메밀|냉면집/,
    visual: { emoji: "🍜", color: "#EA580C", label: "면류" },
  },
  {
    // 이름 기반 매칭 포함: 유어보울/포케/비빔보울 등 브랜드명이 category 코드에 안 잡히는 경우 대비
    test: /샐러드|도시락|다이어트|보울|포케|비빔밥/,
    visual: { emoji: "🥗", color: "#16A34A", label: "샐러드/도시락" },
  },
  {
    // 공공데이터에만 있는 뷔페 분류
    test: /뷔페/,
    visual: { emoji: "🍱", color: "#0EA5E9", label: "뷔페" },
  },
  {
    // 호프/포차 계열 - 통닭에 포함되지 않는 순수 주점 계열
    // "호프/통닭"은 치킨 룰이 먼저 실행되므로 여기선 통닭 없이 호프/포차류만 잡음
    test: /호프|포차|술집|주점|요리주점/,
    visual: { emoji: "🍺", color: "#6366F1", label: "호프/주점" },
  },
];

const DEFAULT_VISUAL: CategoryVisual = { emoji: "🍽️", color: "#6B7280", label: "기타" };

// AI 재분류 스크립트 등에서 "이 라벨 중 하나로만 답하라"고 제약을 걸 때 쓰는 전체 라벨 목록.
export const CATEGORY_LABELS: string[] = [...RULES.map((r) => r.visual.label), DEFAULT_VISUAL.label];

const VISUAL_BY_LABEL = new Map<string, CategoryVisual>([
  ...RULES.map((r): [string, CategoryVisual] => [r.visual.label, r.visual]),
  [DEFAULT_VISUAL.label, DEFAULT_VISUAL],
]);

// categoryLabel: AI(Gemini)나 사람이 확정한 정확한 라벨이 있으면 최우선으로 신뢰한다.
// category: 없거나 모르는 값이면, 기존처럼 네이버/정부 원본 업종 텍스트를 정규식으로 추론한다.
// name: category만으로 분류가 안 될 때(기타간이음식점 등 뭉뚱그린 업종코드) 식당 이름도
//   함께 검사해서 "유어보울 영드포점"처럼 지점명에 브랜드 키워드가 있는 경우도 올바른 카테고리로 분류.
export function getCategoryVisual(
  category: string | null | undefined,
  categoryLabel?: string | null,
  name?: string | null
): CategoryVisual {
  if (categoryLabel) {
    const known = VISUAL_BY_LABEL.get(categoryLabel);
    if (known) return known;
  }
  // category 단독으로 먼저 시도
  if (category) {
    const ruleByCategory = RULES.find((r) => r.test.test(category));
    if (ruleByCategory) return ruleByCategory.visual;
  }
  // category로 못 잡으면 name도 포함해서 재시도 (지점명 브랜드 키워드 매칭)
  if (name) {
    const combined = `${category ?? ""} ${name}`;
    const ruleByName = RULES.find((r) => r.test.test(combined));
    if (ruleByName) return ruleByName.visual;
  }
  return DEFAULT_VISUAL;
}

// 자전거 대여소, 병원, 관공서, 마트 같은 음식점이 아닌 결과를 걸러내는 데 쓴다.
// 네이버 지역검색 API의 category 필드는 대개 "음식점>..." 이거나 "카페,디저트>..."로 시작한다.
// 이 둘 중 하나로 시작하지 않으면 음식/카페 관련이 아니라고 판단해서 제외한다.
export function isFoodRelatedCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return /^\s*(음식점|카페)/.test(category);
}

// "회식"에 어울리는 곳을 판별하는 로직.
// 우선순위: categoryLabel이 "고기"/"호프/주점"/"일식(이자카야)"인 경우를 먼저 체크하고,
// 없으면 category/name 키워드 매칭으로 폴백한다.
// 2026-08-07: categoryLabel 연동 추가 - 확장된 정규식으로 잡힌 고기/주점류가
// 회식 필터에 정확하게 나오도록.
const GROUP_DINING_KEYWORDS =
  /고기|삼겹살|갈비|곱창|막창|이자카야|호프|술집|포차|무한리필|육류요리전문점|돼지갈비|한우|오리구이|닭갈비|요리주점/;

export function isGroupDiningFriendly(
  category: string | null | undefined,
  name: string | null | undefined,
  categoryLabel?: string | null
): boolean {
  // categoryLabel이 확정된 경우 최우선으로 체크
  if (categoryLabel === "고기" || categoryLabel === "호프/주점") return true;
  if (categoryLabel === "일식") {
    // 일식 중에서도 이자카야/요리주점만 회식으로 분류
    const text = `${category ?? ""} ${name ?? ""}`;
    return /이자카야|요리주점/.test(text);
  }
  const text = `${category ?? ""} ${name ?? ""}`;
  return GROUP_DINING_KEYWORDS.test(text);
}

// "여름별미"도 마찬가지로 계절 데이터가 없어서 냉면/빙수류 키워드로 근사하는 휴리스틱.
const SUMMER_SPECIALTY_KEYWORDS = /냉면|콩국수|빙수|냉모밀|메밀국수|냉국수|냉국|밀면|냉면집/;

export function isSummerSpecialty(
  category: string | null | undefined,
  name: string | null | undefined
): boolean {
  const text = `${category ?? ""} ${name ?? ""}`;
  return SUMMER_SPECIALTY_KEYWORDS.test(text);
}
