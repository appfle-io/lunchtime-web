// 네이버 지역검색이 내려주는 category 문자열(예: "음식점>한식>백반,죽")을 보고
// 마커에 쓸 이모지/색상/표시라벨을 결정한다. 정교한 분류가 아니라 키워드 매칭 수준이라
// 애매한 카테고리는 기본값(기타)으로 빠진다.
//
// 2026-08-07 추가: 정부 공공데이터(소상공인시장진흥공단 상가정보)로 시딩한 식당은 업종 텍스트
// 자체가 뭉뚱그려져 있는 경우가 많다(갈비집도 그냥 "한식음식점"으로만 등록되거나, "기타 간이
// 음식점" 같은 진짜 뭉뚱그린 업종으로 등록된 곳도 많음) - 그래서 이 파일의 키워드 정규식만으로는
// 한계가 있다. 이걸 보완하기 위해 scripts/classify-categories-ai.ts가 Gemini로 식당 이름+원본
// 업종 텍스트를 보고 아래 CATEGORY_LABELS 중 하나로 재분류해서 Firestore의 categoryLabel
// 필드에 저장해둔다. getCategoryVisual()은 categoryLabel이 있으면 그걸 최우선으로 신뢰하고,
// 없을 때만 기존처럼 category 원본 텍스트를 정규식으로 추론한다 - 원본 category는 그대로 두고
// "보강"만 하는 방식이라 안전하게 되돌릴 수 있다.
export interface CategoryVisual {
  emoji: string;
  color: string;
  label: string;
}

const RULES: { test: RegExp; visual: CategoryVisual }[] = [
  {
    test: /한식|백반|국밥|찌개|한정식|해장국|감자탕|설렁탕|곰탕|매운탕|추어탕|순두부/,
    visual: { emoji: "🍚", color: "#F59E0B", label: "한식" },
  },
  { test: /중식|중국음식|중화요리|짜장|짬뽕|딤섬|양꼬치/, visual: { emoji: "🥡", color: "#EF4444", label: "중식" } },
  {
    test: /일식|돈부리|라멘|스시|초밥|이자카야|돈까스|우동|사시미|덮밥|규동/,
    visual: { emoji: "🍣", color: "#3B82F6", label: "일식" },
  },
  {
    test: /양식|이탈리아|스테이크|파스타|버거|피자|리조또|브런치/,
    visual: { emoji: "🍔", color: "#8B5CF6", label: "양식" },
  },
  { test: /카페|디저트|베이커리|빵/, visual: { emoji: "☕", color: "#92400E", label: "카페" } },
  { test: /치킨/, visual: { emoji: "🍗", color: "#F97316", label: "치킨" } },
  {
    // "고기" 필터가 실제로 잡아야 하는 회식/구이류 - 보쌈/족발처럼 정육 위주 메뉴도 여기 포함.
    test: /육류|고기|갈비|삼겹살|목살|항정살|곱창|막창|정육|숯불구이|보쌈|족발|우삼겹|한우/,
    visual: { emoji: "🥩", color: "#B91C1C", label: "고기" },
  },
  { test: /분식|떡볶이|김밥|순대|어묵/, visual: { emoji: "🍢", color: "#DB2777", label: "분식" } },
  { test: /국수|칼국수|냉면|쌀국수|메밀/, visual: { emoji: "🍜", color: "#EA580C", label: "면류" } },
  { test: /샐러드|도시락|다이어트/, visual: { emoji: "🥗", color: "#16A34A", label: "샐러드/도시락" } },
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
export function getCategoryVisual(
  category: string | null | undefined,
  categoryLabel?: string | null
): CategoryVisual {
  if (categoryLabel) {
    const known = VISUAL_BY_LABEL.get(categoryLabel);
    if (known) return known;
  }
  if (!category) return DEFAULT_VISUAL;
  const rule = RULES.find((r) => r.test.test(category));
  return rule ? rule.visual : DEFAULT_VISUAL;
}

// 자전거 대여소, 병원, 관공서, 마트 같은 음식점이 아닌 결과를 걸러내는 데 쓴다.
// 네이버 지역검색 API의 category 필드는 대개 "음식점>..." 이거나 "카페,디저트>..."로 시작한다.
// 이 둘 중 하나로 시작하지 않으면 음식/카페 관련이 아니라고 판단해서 제외한다.
export function isFoodRelatedCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return /^\s*(음식점|카페)/.test(category);
}

// "회식"에 어울리는 곳(고기/술자리 위주)을 category/name 키워드로 대충 골라내는 휴리스틱.
// 실제 회식 적합도 데이터가 없어서 카테고리·상호명 텍스트 매칭으로 근사한다 - 정교하지 않으니
// 나중에 사내 투표/리뷰 기반으로 더 정확하게 다듬을 수 있음 (2026-08-06 신규 필터 요청 대응).
const GROUP_DINING_KEYWORDS = /고기|삼겹살|갈비|곱창|막창|이자카야|호프|술집|포차|무한리필/;

export function isGroupDiningFriendly(
  category: string | null | undefined,
  name: string | null | undefined
): boolean {
  const text = `${category ?? ""} ${name ?? ""}`;
  return GROUP_DINING_KEYWORDS.test(text);
}

// "여름별미"도 마찬가지로 계절 데이터가 없어서 냉면/빙수류 키워드로 근사하는 휴리스틱.
const SUMMER_SPECIALTY_KEYWORDS = /냉면|콩국수|빙수|냉모밀|메밀국수|냉국수|냉국|밀면/;

export function isSummerSpecialty(
  category: string | null | undefined,
  name: string | null | undefined
): boolean {
  const text = `${category ?? ""} ${name ?? ""}`;
  return SUMMER_SPECIALTY_KEYWORDS.test(text);
}
