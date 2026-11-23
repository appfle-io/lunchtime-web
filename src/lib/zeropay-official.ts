// 제로페이 공식 가맹점 조회 및 판정 (판정 기준: zeropay.or.kr 가맹점 찾기)
//
// [조회 방식] 가맹점 찾기 화면(UI_HP_009_03.act)이 내부적으로 호출하는 UI_HP_009_03.jct에 JSON을 보낸다.
//   - 예전 코드는 .act에 form 데이터를 보내고 있었는데, 지금 그 주소는 HTML 페이지만 돌려준다
//     (JSON 파싱 실패 -> "검색 결과 0건"으로 처리되어 사실상 모든 조회가 미가맹으로 떨어지던 상태).
//   - 응답: { TOTAL_CNT, PAGE_NUM, PAGE_SIZE(10), LIST2: [{ AFLT_NM, AFLT_ROAD_ADDR, BIZ_TYPE, SHOP_TEL_NO, RECENT_TRAN_YN }] }
//   - AFLT_ROAD_ADDR / AFLT_NM 은 부분 일치 검색이다 ("영중로 1" -> 영중로 145, 영중로 16 ...).
//   - 페이지 간 정렬이 고정되어 있지 않아 같은 항목이 여러 페이지에 나올 수 있다 -> 결과를 모아 중복 제거.
//
// [판정 방식] 제로페이에 등록된 이름은 "사업자명"이라 실제 상호와 다를 수 있다(예: 쏘스 삼겹살 전문점 -> 숯불삼겹살).
// 그래서 상호가 아니라 "주소"를 1차 기준으로 쓴다.
//   1) DB 도로명주소(도로명 + 건물번호)로 검색해 정확히 같은 주소의 가맹점만 남긴다.
//   2) 그중 상호가 같은 브랜드이거나 전화번호가 같으면 confirmed(확정).
//   3) 상호가 달라도 같은 주소의 음식 업종 가맹점이 1~2곳뿐이면 review(관리자 확인 필요)로 후보를 돌려준다.
//   4) 주소로 못 찾으면 상호로 한 번 더 검색하되, 이때도 주소가 정확히 같아야 confirmed.
//      상호는 같은데 주소가 다르면 review(이전/주소 오류 가능성).
//   5) 조회 자체가 실패하면 error. error는 "미가맹"이 아니다 - 기존 값을 바꾸면 안 된다.
// 네이버 지도의 결제수단 표기는 판정에 쓰지 않는다.

export interface TraceStep {
  step: string;
  status: "pass" | "fail" | "skip" | "info";
  message: string;
  details?: Record<string, any>;
}

export type ZeroPayCheckStatus = "confirmed" | "review" | "not_found" | "error";

export interface ZeroPayMerchant {
  name: string;
  address: string;
  bizType: string;
  phone: string;
  recentTransaction: boolean;
}

export interface ZeroPayCandidate extends ZeroPayMerchant {
  addressMatch: boolean;
  /** 공식 주소에 건물번호가 없고 도로명만 같은 경우 */
  roadOnlyMatch: boolean;
  fullNameMatch: boolean;
  nameMatch: boolean;
  phoneMatch: boolean;
  reason: string;
}

export interface ZeroPayOfficialCheckResult {
  status: ZeroPayCheckStatus;
  /** status === "confirmed" 일 때만 true */
  isZeroPay: boolean;
  officialName?: string;
  officialAddress?: string;
  officialPhone?: string;
  bizType?: string;
  recentTransaction?: boolean;
  /** review일 때 관리자에게 보여줄 후보 */
  candidates?: ZeroPayCandidate[];
  /** @deprecated 예전 스크립트 호환용. 더 이상 설정하지 않는다(업종만으로 식당을 지우지 않음). */
  isNotFoodBiz?: boolean;
  message: string;
}

export interface ZeroPayTraceResult {
  result: ZeroPayOfficialCheckResult;
  targetName: string;
  targetAddress: string;
  targetDistrict: string;
  queriesTried: string[];
  steps: TraceStep[];
  matchedReason?: string;
  failedReason?: string;
}

// ---------------------------------------------------------------------------
// 주소 파싱
// ---------------------------------------------------------------------------

// 가맹점 찾기 화면의 시/도 버튼 값. 지금은 서울만 지원하고, 다른 지역은 error로 돌려 미가맹으로 오판하지 않게 한다.
const SIDO_TABLE: { pattern: RegExp; city: string; sub: string }[] = [
  { pattern: /^(서울특별시|서울시|서울)/, city: "서울특별시", sub: "서울" },
];

export interface ParsedRoadAddress {
  city: string;
  citySub: string;
  gu: string;
  /** 도로명 전체 (예: "영신로38길", "영중로14길", "국회대로46길", "영중로") */
  road: string;
  /** 큰 도로명 (예: "영신로") */
  baseRoad: string;
  /** 번길 부분 (예: "38길"), 없으면 null */
  subRoad: string | null;
  mainNo: number;
  subNo: number | null;
}

function cleanAddress(addr: string): string {
  return addr
    .replace(/&amp;/g, "&")
    .replace(/\([^)]*\)/g, " ") // (영등포동6가) 같은 참고항목 제거
    .replace(/[^가-힣A-Za-z0-9\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRoadAddress(rawAddr: string | null | undefined): ParsedRoadAddress | null {
  if (!rawAddr) return null;
  let s = cleanAddress(rawAddr);

  const sido = SIDO_TABLE.find((t) => t.pattern.test(s));
  if (!sido) return null;
  s = s.replace(sido.pattern, "").trim();

  const guMatch = s.match(/^([가-힣]+?(?:구|군))\s*/);
  if (!guMatch) return null;
  const gu = guMatch[1];
  s = s.slice(guMatch[0].length);

  // 도로명 + (번길) + 건물번호. "영중로 14길 11"처럼 번길 앞에 공백이 있는 표기도 같은 주소로 본다.
  // 건물번호 뒤에 "길"이 붙으면 번길이지 건물번호가 아니다 ("버드나루로20길"을 "버드나루로 20"으로 읽지 않게).
  const roadMatch = s.match(
    /^([가-힣A-Za-z0-9]+?(?:대로|로|길))\s*(\d+[가-힣]?길)?\s*(\d+)(?:\s*-\s*(\d+))?(?!\d|[가-힣]?길)/
  );
  if (!roadMatch) return null;

  const baseRoad = roadMatch[1];
  const subRoad = roadMatch[2] ?? null;
  return {
    city: sido.city,
    citySub: sido.sub,
    gu,
    road: baseRoad + (subRoad ?? ""),
    baseRoad,
    subRoad,
    mainNo: Number(roadMatch[3]),
    subNo: roadMatch[4] ? Number(roadMatch[4]) : null,
  };
}

/**
 * 건물번호 없이 도로명까지만 등록된 공식 주소용 (예: "서울특별시 영등포구 선유로" - 편의점 등에서 자주 보인다).
 * 도로명(번길 포함)만 돌려준다.
 */
export function parseRoadName(rawAddr: string | null | undefined): { gu: string; road: string } | null {
  if (!rawAddr) return null;
  let s = cleanAddress(rawAddr);
  const sido = SIDO_TABLE.find((t) => t.pattern.test(s));
  if (!sido) return null;
  s = s.replace(sido.pattern, "").trim();
  const guMatch = s.match(/^([가-힣]+?(?:구|군))\s*/);
  if (!guMatch) return null;
  s = s.slice(guMatch[0].length);
  const m = s.match(/^([가-힣A-Za-z0-9]+?(?:대로|로|길))\s*(\d+[가-힣]?길)?(?=\s|$)/);
  if (!m) return null;
  return { gu: guMatch[1], road: m[1] + (m[2] ?? "") };
}

/** 도로명과 건물 본번이 같고, 양쪽 다 부번이 있으면 부번까지 같아야 같은 주소로 본다. */
export function isSameRoadAddress(a: ParsedRoadAddress | null, b: ParsedRoadAddress | null): boolean {
  if (!a || !b) return false;
  if (a.road !== b.road || a.mainNo !== b.mainNo) return false;
  if (a.subNo !== null && b.subNo !== null && a.subNo !== b.subNo) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 상호 비교
// ---------------------------------------------------------------------------

// 같은 브랜드의 다른 표기. 왼쪽 패턴을 오른쪽 표준형으로 바꾼다.
const BRAND_ALIASES: [RegExp, string][] = [
  [/GS\s*25|지에스\s*25|지에스이십오/gi, "지에스25"],
  [/\bCU\b|씨유/gi, "씨유"],
  [/세븐\s*일레븐|7\s*-?\s*eleven|7일레븐/gi, "세븐일레븐"],
  [/이마트\s*24|emart\s*24/gi, "이마트24"],
  [/메가\s*(MGC|엠지씨)?\s*커피/gi, "메가커피"],
  [/파리바게트/g, "파리바게뜨"],
  [/서브웨이/g, "써브웨이"],
  [/\bBHC\b/gi, "비에이치씨"],
  [/\bBBQ\b/gi, "비비큐"],
  [/스타벅스|starbucks/gi, "스타벅스"],
  [/맥도날드|mcdonald'?s/gi, "맥도날드"],
  [/천씨씨/g, "1000cc"],
];

// 한 이름에 이 중 하나가 있고 다른 이름에 같은 브랜드가 없으면 "다른 가게"로 확정한다 (GS25 ↔ 씨유 등).
const CHAIN_BRANDS = [
  "지에스25", "씨유", "세븐일레븐", "이마트24", "미니스톱", "스타벅스", "이디야", "메가커피", "컴포즈커피",
  "빽다방", "투썸플레이스", "할리스", "폴바셋", "커피빈", "배스킨라빈스", "던킨", "파리바게뜨", "뚜레쥬르",
  "맥도날드", "롯데리아", "버거킹", "맘스터치", "써브웨이", "본죽", "김밥천국", "교촌", "비에이치씨", "비비큐",
  "굽네", "도미노", "피자헛", "쉐이크쉑", "죠스떡볶이", "신전떡볶이", "명랑핫도그",
];

// 상호에서 빼고 비교할 지역/건물/시설 단어 (지점명에 주로 붙는다).
const PLACE_WORDS = [
  "서울특별시", "서울", "영등포구", "영등포", "여의도", "문래", "당산", "신길", "대림", "양평", "도림", "선유도",
  "타임스퀘어", "홈플러스", "신세계백화점", "신세계", "롯데백화점", "현대백화점", "백화점", "하이테크시티",
  "에이스", "푸르지오", "아이비밸리", "시장역", "구청역", "구청", "사거리", "지하", "본관", "별관",
];

// 이 단어만 겹치는 건 같은 가게 근거가 아니다 (순대국집끼리, 삼겹살집끼리는 서로 다른 가게).
const GENERIC_FOOD_WORDS = new Set([
  "김밥", "커피", "카페", "치킨", "피자", "삼겹살", "순대국", "순대", "국밥", "식당", "분식", "족발", "보쌈",
  "곱창", "막창", "갈비", "냉면", "베이커리", "떡볶이", "마라탕", "쌀국수", "돈까스", "짬뽕", "중국집", "횟집",
  "초밥", "스시", "라면", "우동", "샐러드", "호프", "포차", "감자탕", "해장국", "칼국수", "부대찌개", "닭갈비",
  "숯불", "고기", "한식", "일식", "중식", "양식", "주점", "맥주", "치킨집", "반찬", "도시락", "편의점", "마트",
]);

function applyAliases(s: string): string {
  let out = s.replace(/&amp;/g, "&");
  for (const [pattern, to] of BRAND_ALIASES) out = out.replace(pattern, to);
  return out;
}

/** 비교용 핵심 상호: 법인격/괄호/지점명/지역·건물 단어/공백 제거 */
export function coreBusinessName(name: string): string {
  let s = applyAliases(name)
    .replace(/\(주\)|\(유\)|\(사\)|\(재\)|주식회사|유한회사|농업회사법인/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/\bATM\b/gi, " ");

  // 공백으로 나뉜 뒤쪽 토큰 중 "~점"으로 끝나는 지점명 제거 (첫 토큰은 상호 본체라 남긴다)
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    s = [tokens[0], ...tokens.slice(1).filter((t) => !/(점|지점|호점)$/.test(t))].join("");
  } else {
    s = tokens.join("");
  }

  // 붙어 있는 지점명 제거: "얌샘김밥영등포역점" -> "얌샘김밥"
  s = s.replace(/(\d+호점|본점|직영점|분점|지점|점)$/g, "");
  for (const w of PLACE_WORDS) s = s.split(w).join("");
  s = s.replace(/역$/, "").replace(/\d+호$/g, "").replace(/\s+/g, "").toLowerCase();
  return s;
}

/** 체인점 상호에서 브랜드를 뺀 지점명 (지역/건물 단어 제외). 예: "CU 영등포마사회점" -> "마사회" */
function branchOf(name: string, chain: string): string {
  let s = applyAliases(name)
    .replace(/\(주\)|\(유\)|주식회사|유한회사/g, "")
    .replace(/\bATM\b/gi, "")
    .replace(/[()[\]{}\s·.,]/g, "")
    .toLowerCase();
  const idx = s.indexOf(chain.toLowerCase());
  if (idx >= 0) s = s.slice(idx + chain.length);
  s = s.replace(/(\d+호점|본점|직영점|지점|점)$/g, "");
  for (const w of PLACE_WORDS) s = s.split(w.toLowerCase()).join("");
  return s.replace(/역$/, "");
}

function chainOf(core: string): string | null {
  return CHAIN_BRANDS.find((b) => core.includes(b.toLowerCase())) ?? null;
}

function longestCommonSubstring(a: string, b: string): string {
  if (!a || !b) return "";
  let best = "";
  const dp: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > best.length) best = a.slice(i - dp[j], i);
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}

function isGenericOnly(fragment: string): boolean {
  if (GENERIC_FOOD_WORDS.has(fragment)) return true;
  // "숯불삼겹살"처럼 일반 단어 조합으로만 이루어진 경우
  let rest = fragment;
  for (const w of Array.from(GENERIC_FOOD_WORDS).sort((x, y) => y.length - x.length)) rest = rest.split(w).join("");
  return rest.length === 0;
}

/**
 * 두 상호가 같은 가게(브랜드)를 가리키는지. 주소가 이미 같다는 전제에서 "확정" 근거로 쓰므로
 * 애매하면 false를 돌려준다(그 경우 review로 관리자 확인을 받는다).
 */
export function validateBrandMatch(dbName: string, officialName: string): boolean {
  const a = coreBusinessName(dbName);
  const b = coreBusinessName(officialName);
  if (a.length < 2 || b.length < 2) return false;

  const chainA = chainOf(a);
  const chainB = chainOf(b);
  if (chainA || chainB) {
    if (chainA !== chainB) return false;
    // 같은 체인이면 지점명도 비교한다 (같은 건물에 "씨유 영등포마사회점"과 "씨유 L영등포지사8층점"이 따로 있을 수 있음).
    const branchA = branchOf(dbName, chainA!);
    const branchB = branchOf(officialName, chainA!);
    if (branchA.length >= 2 && branchB.length >= 2) {
      return longestCommonSubstring(branchA, branchB).length >= 2;
    }
    return true;
  }

  if (a === b) return !isGenericOnly(a);

  const common = longestCommonSubstring(a, b);
  if (common.length < 2 || isGenericOnly(common)) return false;
  const shorter = Math.min(a.length, b.length);
  // 짧은 쪽 상호의 대부분(60% 이상)이 겹쳐야 같은 브랜드로 본다. "라밥" vs "라밥LABAB" 같은 경우 포함.
  return common.length >= Math.max(2, Math.ceil(shorter * 0.6));
}

/** 지점명까지 포함해 거의 같은 이름인지 (도로명만 일치하는 경우의 확정 근거). */
export function isSameFullName(dbName: string, officialName: string): boolean {
  const norm = (s: string) =>
    applyAliases(s)
      .replace(/\(주\)|\(유\)|주식회사|유한회사/g, "")
      .replace(/\bATM\b/gi, "")
      .replace(/[()[\]{}\s·.,]/g, "")
      .replace(/점$/, "")
      .toLowerCase();
  const a = norm(dbName);
  const b = norm(officialName);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * 핵심 상호(지점명·지역명 제외)에 일반 음식 단어가 아닌 두 글자 이상 공통 부분이 있는지.
 * "월화고기"/"월화미트"는 true, "에스파냐도넛"/"루루도넛"("도넛"만 겹침)은 false.
 * 주소가 이미 같은 경우에만 같은 가게 근거로 쓴다 (네이버 매칭, naver-match.ts).
 */
export function sharesDistinctiveName(a: string, b: string, extraGenericWords: string[] = []): boolean {
  const ca = coreBusinessName(a);
  const cb = coreBusinessName(b);
  if (ca && ca === cb) return true; // "킹"/"킹"처럼 한 글자 상호도 완전히 같으면 인정
  let common = longestCommonSubstring(ca, cb);
  if (common.length < 2) return false;
  if (isGenericOnly(common)) return false;
  for (const w of extraGenericWords) common = common.split(w).join("");
  return common.length >= 2 && !isGenericOnly(common);
}

/** 상호가 같다고 보긴 어렵지만 관계가 있어 보이는지 (같은 주소 후보를 관리자 검토로 올릴지 판단). */
function hasWeakNameRelation(dbName: string, officialName: string): boolean {
  if (/주식회사|\(주\)|㈜|유한회사|농업회사법인/.test(officialName)) return true; // 사업자명이 법인명인 경우
  const common = longestCommonSubstring(coreBusinessName(dbName), coreBusinessName(officialName));
  return common.length >= 2;
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/[^0-9]/g, "");
}

function isPhoneMatch(dbPhone: string | null | undefined, officialPhone: string): boolean {
  const a = digitsOnly(dbPhone);
  const b = digitsOnly(officialPhone);
  if (a.length < 9 || b.length < 9) return false;
  if (/^0+$/.test(b.slice(2)) || /^0+$/.test(b.slice(3))) return false; // 020000000 같은 더미값
  return a === b;
}

const FOOD_BIZ_KEYWORDS = [
  "음식점", "요리", "주점", "커피", "카페", "제과", "빵", "피자", "햄버거", "샌드위치", "치킨", "김밥", "분식",
  "간이 음식", "포장 판매", "휴게", "편의점", "슈퍼", "식료품", "빙과", "아이스크림", "떡", "반찬", "도시락",
  "구내식당", "출장 음식", "음료", "차 전문점", "맥주",
];

function isFoodBizType(bizType: string): boolean {
  if (!bizType) return true; // 업종 정보가 없으면 제외하지 않는다
  return FOOD_BIZ_KEYWORDS.some((kw) => bizType.includes(kw));
}

// ---------------------------------------------------------------------------
// 공식 서버 조회
// ---------------------------------------------------------------------------

const ZEROPAY_ENDPOINT = "https://www.zeropay.or.kr/UI_HP_009_03.jct";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PAGE_SIZE = 10;
const MAX_ADDRESS_PAGES = 5;
const MAX_NAME_PAGES = 2;

// 가맹점 찾기 화면의 업종 선택값 중 식음료 관련 코드. 결과가 많은 큰 건물(시장/백화점/복합상가)은
// 업종별로 나눠 다시 조회해야 빠짐없이 확인할 수 있다 (결과 정렬이 고정되지 않아 페이지를 넘겨도 누락이 생김).
const FOOD_BIZ_CODES = [
  "56111", "56113", "56121", "56122", "56123", "56161", "56162", "56191", "56199",
  "56150", "56213", "56219", "56221", "47122", "47121", "47129",
];
const BIZ_QUERY_CONCURRENCY = 4;
// 같은 주소의 식음료 가맹점이 이 수 이하일 때만 "상호는 다르지만 같은 가게일 수 있는" 후보를 올린다.
const SMALL_BUILDING_FOOD_LIMIT = 3;

interface SearchParams {
  city: string;
  citySub: string;
  gu: string;
  name?: string;
  roadAddr?: string;
  bizCode?: string;
}

interface SearchOutcome {
  merchants: ZeroPayMerchant[];
  totalCount: number;
  /** 모든 페이지를 다 받지 못했으면 true (큰 건물 등) */
  incomplete: boolean;
}

async function fetchPage(params: SearchParams, page: number): Promise<{ list: any[]; total: number }> {
  const body = {
    AFLT_ADDR_CITY: params.city,
    AFLT_ADDR_CITY_SUB_1: params.citySub,
    AFLT_ADDR_CITY_SUB_2: params.citySub,
    AFLT_ADDR_GU: params.gu,
    AFLT_NM: params.name ?? "",
    AFLT_ROAD_ADDR: params.roadAddr ?? "",
    BIZ_TYPE_CD: params.bizCode ?? "",
    TRX_TP: "01",
    PAGE_NUM: page,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt)); // 일시적 차단/지연 대비
    try {
      const res = await fetch(ZEROPAY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": BROWSER_UA,
          Referer: "https://www.zeropay.or.kr/UI_HP_009_03.act",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("제로페이 서버가 JSON이 아닌 응답을 돌려줬습니다 (조회 방식 변경 가능성)");
      }
      if (json?.COMMON_HEAD?.ERROR) {
        throw new Error(`제로페이 서버 오류: [${json.COMMON_HEAD.CODE}] ${json.COMMON_HEAD.MESSAGE}`);
      }
      return { list: Array.isArray(json?.LIST2) ? json.LIST2 : [], total: Number(json?.TOTAL_CNT ?? 0) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function searchMerchants(params: SearchParams, maxPages: number): Promise<SearchOutcome> {
  const seen = new Map<string, ZeroPayMerchant>();
  const collect = (list: any[]) => {
    for (const item of list) {
      const m: ZeroPayMerchant = {
        name: String(item.AFLT_NM ?? "").trim(),
        address: String(item.AFLT_ROAD_ADDR ?? "").trim(),
        bizType: String(item.BIZ_TYPE ?? "").trim(),
        phone: String(item.SHOP_TEL_NO ?? "").trim(),
        recentTransaction: item.RECENT_TRAN_YN === "Y",
      };
      seen.set(`${m.name}|${m.address}`, m);
    }
  };

  const first = await fetchPage(params, 1);
  collect(first.list);
  const total = first.total;
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), maxPages);

  // 서버 정렬이 고정돼 있지 않아 페이지끼리 항목이 겹치고 일부가 빠진다.
  // 나머지 페이지를 받은 뒤에도 모은 개수가 전체보다 적으면 한 번 더 받아 빠진 항목을 채운다.
  for (let pass = 0; pass < 2 && pages > 1; pass++) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => fetchPage(params, i + 2))
    );
    rest.forEach((r) => collect(r.list));
    if (pass === 0) {
      // 첫 페이지도 다시 받아본다 (같은 페이지 번호라도 내용이 달라질 수 있음)
      collect((await fetchPage(params, 1)).list);
    }
    if (seen.size >= total) break;
  }

  return {
    merchants: Array.from(seen.values()),
    totalCount: total,
    incomplete: seen.size < total,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 주소 검색. 결과가 많으면 식음료 업종별로 나눠 다시 조회해 합친다. */
async function searchByAddress(base: Omit<SearchParams, "roadAddr">, roadAddr: string): Promise<SearchOutcome> {
  const first = await searchMerchants({ ...base, roadAddr }, MAX_ADDRESS_PAGES);
  if (!first.incomplete) return first;

  const byBiz = await mapWithConcurrency(FOOD_BIZ_CODES, BIZ_QUERY_CONCURRENCY, (bizCode) =>
    searchMerchants({ ...base, roadAddr, bizCode }, MAX_ADDRESS_PAGES)
  );
  const merged = new Map<string, ZeroPayMerchant>();
  for (const m of first.merchants) merged.set(`${m.name}|${m.address}`, m);
  for (const o of byBiz) for (const m of o.merchants) merged.set(`${m.name}|${m.address}`, m);
  return {
    merchants: Array.from(merged.values()),
    totalCount: first.totalCount,
    // 업종별 조회까지 다 받았으면 식음료 업종 기준으로는 빠짐없이 확인한 것으로 본다.
    incomplete: byBiz.some((o) => o.incomplete),
  };
}

function addressQueryFor(addr: ParsedRoadAddress): string {
  // 부분 일치 검색이므로 번길이 있으면 "38길 23"으로 검색해 "영신로38길 23" / "영신로 38길 23" 표기를 모두 잡는다.
  return addr.subRoad ? `${addr.subRoad} ${addr.mainNo}` : `${addr.baseRoad} ${addr.mainNo}`;
}

function nameQueriesFor(name: string): string[] {
  // 제로페이 상호 검색은 부분 일치지만 띄어쓰기를 그대로 비교한다 ("씨유 문래벤처" 0건, "씨유문래벤처" 1건).
  const queries = new Set<string>();
  const decoded = applyAliases(name.replace(/&amp;/g, "&"))
    .replace(/\bATM\b/gi, "")
    .replace(/\([^)]*\)/g, " ")
    .trim();
  let compactFull = decoded.replace(/\s+/g, "").replace(/점$/, "");
  // 체인점은 브랜드 앞에 붙은 말("롯데ATM 세븐일레븐 문래윤서")을 떼고 "브랜드+지점명"으로 검색한다.
  const chain = CHAIN_BRANDS.find((b) => compactFull.includes(b));
  if (chain) compactFull = compactFull.slice(compactFull.indexOf(chain));
  if (compactFull.length >= 2 && !isGenericOnly(compactFull) && compactFull !== chain) queries.add(compactFull);
  const core = coreBusinessName(decoded);
  // 체인 브랜드명만 남는 경우("씨유")는 결과가 너무 많아 의미가 없으므로 검색하지 않는다.
  if (core.length >= 2 && !isGenericOnly(core) && !CHAIN_BRANDS.includes(core)) queries.add(core);
  return Array.from(queries).slice(0, 2);
}

function toCandidate(
  m: ZeroPayMerchant,
  dbName: string,
  dbAddr: ParsedRoadAddress | null,
  dbPhone: string | null | undefined
): ZeroPayCandidate {
  const officialAddr = parseRoadAddress(m.address);
  const addressMatch = isSameRoadAddress(dbAddr, officialAddr);
  let roadOnlyMatch = false;
  if (!officialAddr && dbAddr) {
    const roadOnly = parseRoadName(m.address);
    roadOnlyMatch = Boolean(roadOnly && roadOnly.gu === dbAddr.gu && roadOnly.road === dbAddr.road);
  }
  const nameMatch = validateBrandMatch(dbName, m.name);
  const fullNameMatch = isSameFullName(dbName, m.name);
  const phoneMatch = isPhoneMatch(dbPhone, m.phone);
  const reasons: string[] = [];
  reasons.push(addressMatch ? "주소 일치" : roadOnlyMatch ? "도로명 일치(공식 주소에 번지 없음)" : "주소 불일치");
  reasons.push(fullNameMatch ? "상호·지점명 일치" : nameMatch ? "상호 일치" : "상호 다름");
  if (phoneMatch) reasons.push("전화번호 일치");
  return { ...m, addressMatch, roadOnlyMatch, nameMatch, fullNameMatch, phoneMatch, reason: reasons.join(", ") };
}

function confirmedResult(c: ZeroPayCandidate, message: string): ZeroPayOfficialCheckResult {
  return {
    status: "confirmed",
    isZeroPay: true,
    officialName: c.name,
    officialAddress: c.address,
    officialPhone: c.phone,
    bizType: c.bizType,
    recentTransaction: c.recentTransaction,
    message,
  };
}

export interface ZeroPayCheckInput {
  name: string;
  address?: string | null;
  phone?: string | null;
}

/**
 * 제로페이 공식 사이트 기준 가맹 여부 판정 (단계별 기록 포함).
 * 하위 호환: (name, address, phone?) 형태로도 호출할 수 있다.
 */
export async function checkZeroPayOfficialWithTrace(
  nameOrInput: string | ZeroPayCheckInput,
  dbAddressArg?: string | null,
  dbPhoneArg?: string | null
): Promise<ZeroPayTraceResult> {
  const input: ZeroPayCheckInput =
    typeof nameOrInput === "string" ? { name: nameOrInput, address: dbAddressArg, phone: dbPhoneArg } : nameOrInput;
  const name = input.name ?? "";
  const address = input.address ?? "";
  const steps: TraceStep[] = [];
  const queriesTried: string[] = [];
  const dbAddr = parseRoadAddress(address);

  const finish = (result: ZeroPayOfficialCheckResult): ZeroPayTraceResult => ({
    result,
    targetName: name,
    targetAddress: address,
    targetDistrict: dbAddr?.gu ?? "",
    queriesTried,
    steps,
    matchedReason: result.status === "confirmed" ? result.message : undefined,
    failedReason: result.status === "confirmed" ? undefined : result.message,
  });

  if (!dbAddr) {
    steps.push({
      step: "1. 주소 해석",
      status: "fail",
      message: `도로명주소를 해석하지 못했습니다: '${address || "(주소 없음)"}' (서울 도로명주소만 지원)`,
    });
  } else {
    steps.push({
      step: "1. 주소 해석",
      status: "info",
      message: `${dbAddr.city} ${dbAddr.gu} ${dbAddr.road} ${dbAddr.mainNo}${dbAddr.subNo !== null ? `-${dbAddr.subNo}` : ""}`,
      details: { ...dbAddr },
    });
  }

  // 주소를 모르면 구(區)도 모르므로 조회할 수 없다. 미가맹으로 단정하지 않고 error로 돌려준다.
  if (!dbAddr) {
    return finish({ status: "error", isZeroPay: false, message: "주소를 해석할 수 없어 제로페이 조회를 하지 못했습니다." });
  }

  const base = { city: dbAddr.city, citySub: dbAddr.citySub, gu: dbAddr.gu };
  const allCandidates = new Map<string, ZeroPayCandidate>();
  let hadError = false;

  // 1) 주소 검색
  const addrQuery = addressQueryFor(dbAddr);
  queriesTried.push(`주소:${addrQuery}`);
  let addressSearchIncomplete = false;
  try {
    const outcome = await searchByAddress(base, addrQuery);
    addressSearchIncomplete = outcome.incomplete;
    const atAddress = outcome.merchants
      .map((m) => toCandidate(m, name, dbAddr, input.phone))
      .filter((c) => c.addressMatch);
    atAddress.forEach((c) => allCandidates.set(`${c.name}|${c.address}`, c));
    steps.push({
      step: "2. 주소로 조회",
      status: "info",
      message: `'${addrQuery}' 검색 ${outcome.totalCount}건 중 같은 주소 ${atAddress.length}건${outcome.incomplete ? " (결과가 많아 일부만 확인)" : ""}`,
      details: { query: addrQuery, total: outcome.totalCount, atAddress: atAddress.map((c) => `${c.name} / ${c.bizType}`) },
    });

    // 식당 정보와 비교하는 것이므로 확정은 식음료 업종 가맹점만 (같은 건물의 꽃집 등과 이름이 겹쳐도 확정하지 않음)
    const foodAtAddress = atAddress.filter((c) => isFoodBizType(c.bizType));
    const confirmed = foodAtAddress.find((c) => c.nameMatch) ?? foodAtAddress.find((c) => c.phoneMatch);
    if (confirmed) {
      steps.push({ step: "3. 판정", status: "pass", message: `확정: '${confirmed.name}' (${confirmed.reason})` });
      return finish(confirmedResult(confirmed, `같은 주소의 제로페이 가맹점 '${confirmed.name}' 확인 (${confirmed.reason})`));
    }
  } catch (err) {
    hadError = true;
    steps.push({ step: "2. 주소로 조회", status: "fail", message: `조회 실패: ${(err as Error).message}` });
  }

  // 2) 상호 검색 (주소 검색에서 확정 못 했을 때)
  for (const q of nameQueriesFor(name)) {
    queriesTried.push(`상호:${q}`);
    try {
      const outcome = await searchMerchants({ ...base, name: q }, MAX_NAME_PAGES);
      const cands = outcome.merchants.map((m) => toCandidate(m, name, dbAddr, input.phone));
      const foodCands = cands.filter((c) => isFoodBizType(c.bizType));
      const confirmed =
        foodCands.find((c) => c.addressMatch && (c.nameMatch || c.phoneMatch)) ??
        foodCands.find((c) => c.roadOnlyMatch && (c.fullNameMatch || c.phoneMatch));
      steps.push({
        step: "2. 상호로 조회",
        status: "info",
        message: `'${q}' 검색 ${outcome.totalCount}건`,
        details: { query: q, results: cands.slice(0, 10).map((c) => `${c.name} / ${c.address} (${c.reason})`) },
      });
      if (confirmed) {
        steps.push({ step: "3. 판정", status: "pass", message: `확정: '${confirmed.name}' (${confirmed.reason})` });
        return finish(confirmedResult(confirmed, `상호 검색으로 같은 주소의 가맹점 '${confirmed.name}' 확인 (${confirmed.reason})`));
      }
      // 같은 가게로 보이는데 주소가 다른 경우: 같은 길에서 번지만 다르거나(이전/표기 차이),
      // 도로명만 같고 공식 주소에 번지가 없는 경우 -> 관리자 확인. 체인점의 다른 지점은 제외한다.
      cands
        .filter((c) => !c.addressMatch && c.nameMatch)
        .filter((c) => {
          const isChain = Boolean(chainOf(coreBusinessName(c.name)));
          if (c.roadOnlyMatch) return !isChain || c.fullNameMatch;
          if (isChain) return false;
          const off = parseRoadAddress(c.address) ?? parseRoadName(c.address);
          return Boolean(off && off.road === dbAddr.road);
        })
        .forEach((c) => allCandidates.set(`${c.name}|${c.address}`, c));
    } catch (err) {
      hadError = true;
      steps.push({ step: "2. 상호로 조회", status: "fail", message: `'${q}' 조회 실패: ${(err as Error).message}` });
    }
  }

  // 3) 확정은 못 했지만 관리자가 판단할 만한 후보
  const sameAddressFood = Array.from(allCandidates.values()).filter((c) => c.addressMatch && isFoodBizType(c.bizType));
  const sameBrandElsewhere = Array.from(allCandidates.values()).filter((c) => !c.addressMatch && c.nameMatch);
  const reviewCandidates: ZeroPayCandidate[] = [];
  // 사업자명이 상호와 다른 같은 가게일 수 있는 경우: 식음료 가맹점이 3곳 이하인 건물에서, 상호에 겹치는
  // 단어가 있거나(예: 쏘스 삼겹살 전문점 / 숯불삼겹살, 호프365 / 혜경호프) 사업자명이 법인명인 곳이 1~2곳.
  // 상가 건물의 이웃 가게(겹치는 단어 없음)는 후보로 올리지 않는다.
  // 음식점이 많은 큰 건물(푸드코트/백화점/쇼핑몰)에서는 흔한 단어("커피")나 법인명만으로는 근거가 안 되므로 제외한다.
  const relatedAtAddress =
    sameAddressFood.length <= SMALL_BUILDING_FOOD_LIMIT
      ? sameAddressFood.filter((c) => hasWeakNameRelation(name, c.name))
      : [];
  if (relatedAtAddress.length > 0 && relatedAtAddress.length <= 2) {
    reviewCandidates.push(...relatedAtAddress);
  }
  reviewCandidates.push(...sameBrandElsewhere.slice(0, 3));
  const otherTenants = sameAddressFood.filter((c) => !reviewCandidates.includes(c));

  if (reviewCandidates.length > 0) {
    steps.push({
      step: "3. 판정",
      status: "info",
      message: `관리자 확인 필요: ${reviewCandidates.map((c) => `'${c.name}'(${c.reason})`).join(", ")}`,
    });
    return finish({
      status: "review",
      isZeroPay: false,
      candidates: reviewCandidates,
      message: `확정할 근거는 부족하지만 후보 ${reviewCandidates.length}곳이 있습니다: ${reviewCandidates
        .map((c) => `${c.name} (${c.reason})`)
        .join(" / ")}`,
    });
  }

  if (hadError) {
    steps.push({ step: "3. 판정", status: "fail", message: "조회 중 오류가 있어 판정을 보류합니다." });
    return finish({ status: "error", isZeroPay: false, message: "제로페이 서버 조회 중 오류가 발생해 판정을 보류했습니다." });
  }

  const note =
    otherTenants.length > 0
      ? ` (같은 주소의 다른 가맹점: ${otherTenants.slice(0, 3).map((c) => c.name).join(", ")})`
      : addressSearchIncomplete
      ? " (같은 주소 검색 결과가 많아 일부만 확인함)"
      : "";
  steps.push({ step: "3. 판정", status: "fail", message: `제로페이 가맹점을 찾지 못했습니다${note}` });
  return finish({ status: "not_found", isZeroPay: false, message: `제로페이 공식 사이트에서 이 가게를 찾지 못했습니다${note}` });
}

/** 기존 호출부 호환용 (세 번째 인자는 예전 Playwright 컨텍스트 자리라 무시한다). */
export async function checkZeroPayOfficial(
  merchantName: string,
  dbAddress?: string | null,
  _legacyContext?: unknown,
  dbPhone?: string | null
): Promise<ZeroPayOfficialCheckResult> {
  const { result } = await checkZeroPayOfficialWithTrace({ name: merchantName, address: dbAddress, phone: dbPhone });
  return result;
}
