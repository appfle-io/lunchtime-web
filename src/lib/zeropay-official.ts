import { chromium, type BrowserContext } from "playwright";

export interface ZeroPayOfficialCheckResult {
  isZeroPay: boolean;
  officialName?: string;
  officialAddress?: string;
  bizType?: string;
  isNotFoodBiz?: boolean;
}

const FOOD_BIZ_KEYWORDS = [
  "음식점", "육류", "요리", "중식", "일식", "서양식", "제과", "피자", "햄버거",
  "샌드위치", "치킨", "김밥", "간이", "포장", "생맥주", "주점", "커피", "카페",
  "베이커리", "분식", "휴게음식", "패스트푸드", "식당", "떡볶이", "해장국", "단팥빵",
  "편의점", "소매", "슈퍼", "유통"
];

function isFoodBizType(bizType: string | null | undefined): boolean {
  if (!bizType) return true;
  return FOOD_BIZ_KEYWORDS.some((kw) => bizType.includes(kw));
}

function extractDistrict(addr?: string): string {
  if (!addr) return "영등포구";
  const match = addr.match(/([가-힣]+[구|시|군])/);
  return match ? match[1] : "영등포구";
}

function extractDong(addr: string): string | null {
  if (!addr) return null;
  const match = addr.match(/([가-힣]+동[0-9]*가?)/);
  return match ? match[1] : null;
}

function extractRoadName(addr: string): string | null {
  if (!addr) return null;
  const match = addr.match(/([가-힣]+로|[가-힣]+길)/);
  return match ? match[1] : null;
}

function extractBuildingNum(addr: string): string | null {
  if (!addr) return null;
  const match = addr.match(/([가-힣]+로|[가-힣]+길)\s*([0-9]+)/);
  return match ? match[2] : null;
}

export function validateBrandMatch(dbName: string, officialName: string): boolean {
  if (!dbName || !officialName) return false;

  const normalize = (s: string) =>
    s
      .replace(/\(주\)|\(유\)|주식회사/g, "")
      .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, "")
      .replace(/^(서울특별시|서울시|영등포구|영등포|마포구|마포|강남구|강남|구로구|구로|관악구|관악|동작구|동작|서초구|서초|용산구|용산|종로구|종로|중구)\s*/i, "")
      .replace(/(영등포|문래|당산|여의도|타임스퀘어|신길|대림|양평|도림)?\s*(시장점|역점|본점|직영점|[0-9]+호점|점)$/gi, "")
      .replace(/GS25/gi, "지에스")
      .replace(/CU/gi, "씨유")
      .replace(/BHC/gi, "비에이치씨")
      .replace(/BBQ/gi, "비비큐")
      .replace(/\s+/g, "")
      .toLowerCase();

  const n1 = normalize(dbName);
  const n2 = normalize(officialName);

  if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true;

  // Extract core brand words excluding generic building/area terms
  const GENERIC_WORDS = new Set([
    "타임스퀘어", "홈플러스", "성심", "하이테크시티", "백화점", "신세계", "롯데", "현대", "빌딩", "타워",
    "영등포", "여의도", "문래", "당산", "신길", "대림", "양평", "도림", "구청", "역", "사거리", "교차로"
  ]);

  const dbWords = (dbName.match(/[\uAC00-\uD7A3a-zA-Z0-9]+/g) ?? [])
    .filter((w) => w.length >= 2 && !GENERIC_WORDS.has(w) && !/^[0-9]+(호점|점|층|F)?$/i.test(w));

  if (dbWords.length === 0) return true; // Fallback if no specific word

  return dbWords.some((w) => {
    const normW = normalize(w);
    return normW.length >= 2 && n2.includes(normW);
  });
}

function isAddressMatched(dbAddr: string, officialAddr: string): boolean {
  if (!dbAddr || !officialAddr) return true;

  const dbRoad = extractRoadName(dbAddr);
  const offRoad = extractRoadName(officialAddr);
  const dbNum = extractBuildingNum(dbAddr);
  const offNum = extractBuildingNum(officialAddr);

  if (dbRoad && offRoad && dbRoad === offRoad) {
    if (!dbNum || !offNum) return true;
    if (Math.abs(Number(dbNum) - Number(offNum)) <= 5) {
      return true;
    }
  }

  const dbDong = extractDong(dbAddr);
  const offDong = extractDong(officialAddr);
  if (dbDong && offDong && dbDong === offDong) {
    return true;
  }

  return false;
}

function generateQueryVariants(name: string): string[] {
  const list: string[] = [];

  list.push(name);
  list.push(name.replace(/\s+/g, ""));

  let strippedDistrict = name
    .replace(/^(서울특별시|서울시|영등포구|영등포|마포구|마포|강남구|강남|구로구|구로|관악구|관악|동작구|동작|서초구|서초|용산구|용산|종로구|종로|중구)\s*/i, "")
    .trim();
  if (strippedDistrict && strippedDistrict !== name) {
    list.push(strippedDistrict);
    list.push(strippedDistrict.replace(/\s+/g, ""));
  }

  let clean1 = name
    .replace(/\(주\)|\(유\)|주식회사/g, "")
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, "")
    .replace(/(영등포|문래|당산|여의도|타임스퀘어|신길|대림|양평|도림)?\s*(시장점|역점|본점|직영점|[0-9]+호점|점)$/gi, "")
    .trim();
  if (clean1) {
    list.push(clean1);
    list.push(clean1.replace(/\s+/g, ""));
  }

  const noSuffix = name.replace(/\s*점$/i, "").trim();
  if (noSuffix) {
    list.push(noSuffix);
    list.push(noSuffix.replace(/\s+/g, ""));
  }

  let brandVariant = name
    .replace(/GS25/gi, "지에스25")
    .replace(/CU/gi, "씨유")
    .replace(/서브웨이/g, "써브웨이")
    .replace(/천씨씨/g, "1000cc")
    .replace(/삼삼/g, "33");
  if (brandVariant !== name) {
    list.push(brandVariant);
    list.push(brandVariant.replace(/\s+/g, ""));
    list.push(brandVariant.replace(/\s*점$/i, "").trim());
  }

  const GENERIC_BUILDING_WORDS = new Set([
    "타임스퀘어", "홈플러스", "성심", "하이테크시티", "백화점", "신세계", "롯데", "현대", "빌딩", "타워",
    "영등포", "여의도", "문래", "당산", "신길", "대림", "양평", "도림", "구청", "역"
  ]);

  const koreanWords = (clean1 || name).match(/[\uAC00-\uD7A3]+/g) ?? [];
  for (const w of koreanWords) {
    if (w.length >= 2 && !GENERIC_BUILDING_WORDS.has(w)) list.push(w);
  }

  return [...new Set(list)].filter((q) => q && q.length >= 2);
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Pure HTTP fetch를 통한 제로페이 가맹점 직접 조회 (Vercel Serverless 환경 100% 지원)
 */
async function queryZeroPayPureHttp(
  merchantName: string,
  dbAddress?: string
): Promise<ZeroPayOfficialCheckResult | null> {
  try {
    const targetDistrict = extractDistrict(dbAddress);
    const variants = generateQueryVariants(merchantName);

    for (const queryKey of variants) {
      const bodyParams = new URLSearchParams({
        AFLT_ADDR_CITY: "서울특별시",
        AFLT_ADDR_CITY_SIMPLE: "서울",
        AFLT_ADDR_GU: targetDistrict,
        AFLT_NM: queryKey,
        AFLT_ROAD_ADDR: "",
        BIZ_TYPE_CD: "",
        TRX_TP: "01",
      });

      const res = await fetch("https://www.zeropay.or.kr/UI_HP_009_03.act", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": BROWSER_UA,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": "https://www.zeropay.or.kr/UI_HP_009_03.act",
        },
        body: bodyParams.toString(),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      const list = json?.LIST2 ?? [];

      if (Array.isArray(list) && list.length > 0) {
        const matched = list.find((item: any) => {
          const itemAddr = item.AFLT_ROAD_ADDR ?? "";
          const itemNm = item.AFLT_NM ?? "";
          return isAddressMatched(dbAddress ?? "", itemAddr) && validateBrandMatch(merchantName, itemNm);
        });

        if (matched) {
          const bizType = matched.BIZ_TYPE ?? "";
          if (!isFoodBizType(bizType)) {
            return { isZeroPay: false, isNotFoodBiz: true, bizType };
          }
          return {
            isZeroPay: true,
            officialName: matched.AFLT_NM,
            officialAddress: matched.AFLT_ROAD_ADDR,
            bizType,
          };
        }
      }
    }
  } catch (_) {
    // 회사망 차단 또는 타임아웃 발생 시 null 반환하여 다음 처리
  }
  return null;
}

export async function checkZeroPayOfficial(
  merchantName: string,
  dbAddress?: string,
  existingContext?: BrowserContext
): Promise<ZeroPayOfficialCheckResult> {
  // 1. 먼저 Pure HTTP fetch 시도 (Vercel Serverless 호환, Playwright 불필요)
  const pureHttpResult = await queryZeroPayPureHttp(merchantName, dbAddress);
  if (pureHttpResult !== null) {
    return pureHttpResult;
  }

  // 2. existingContext가 명시적으로 전달된 경우에만 Playwright 실행 (로컬 특수 스크립트용)
  // existingContext가 없으면 Vercel 등 무헤드 브라우저 미지원 환경이므로 chromium.launch를 절대 호출하지 않음.
  if (!existingContext) {
    return { isZeroPay: false };
  }

  const context = existingContext;
  let page: any = null;
  let isZeroPay = false;
  let officialName: string | undefined;
  let officialAddress: string | undefined;
  let bizType: string | undefined;
  let isNotFoodBiz = false;

  try {
    page = await context.newPage();

    try {
      await page.goto("https://www.zeropay.or.kr/UI_HP_009_03.act", {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
      await page.waitForTimeout(500);
    } catch (_) {
      return { isZeroPay: false };
    }

    const targetDistrict = extractDistrict(dbAddress);
    const variants = generateQueryVariants(merchantName);

    for (const queryKey of variants) {
      const list: any[] = await page.evaluate(async ({ q, gu }: { q: string; gu: string }) => {
        return new Promise((resolve) => {
          const win = window as any;
          if (typeof win.comAjax === "function") {
            const reqParm = {
              AFLT_ADDR_CITY: "서울특별시",
              AFLT_ADDR_CITY_SIMPLE: "서울",
              AFLT_ADDR_GU: gu,
              AFLT_NM: q,
              AFLT_ROAD_ADDR: "",
              BIZ_TYPE_CD: "",
              TRX_TP: "01",
            };
            win.comAjax(
              "UI_HP_009_03",
              reqParm,
              (data: any) => {
                resolve(data?.LIST2 ?? []);
              },
              () => resolve([]),
              false
            );
          } else {
            resolve([]);
          }
        });
      }, { q: queryKey, gu: targetDistrict });

      if (list.length > 0) {
        const matched = list.find((item: any) => {
          const itemAddr = item.AFLT_ROAD_ADDR ?? "";
          const itemNm = item.AFLT_NM ?? "";
          return isAddressMatched(dbAddress ?? "", itemAddr) && validateBrandMatch(merchantName, itemNm);
        });

        if (matched) {
          bizType = matched.BIZ_TYPE ?? "";
          if (!isFoodBizType(bizType)) {
            isZeroPay = false;
            isNotFoodBiz = true;
          } else {
            isZeroPay = true;
            officialName = matched.AFLT_NM;
            officialAddress = matched.AFLT_ROAD_ADDR;
          }
          break;
        }
      }
    }
  } catch (err) {
    console.warn(`[ZeroPay-Official] "${merchantName}" 검증 예외:`, (err as Error).message);
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return { isZeroPay, officialName, officialAddress, bizType, isNotFoodBiz };
}
