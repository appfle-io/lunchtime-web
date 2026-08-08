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
  "베이커리", "분식", "휴게음식", "패스트푸드", "식당", "떡볶이", "해장국", "단팥빵"
];

function isFoodBizType(bizType: string | null | undefined): boolean {
  if (!bizType) return true;
  return FOOD_BIZ_KEYWORDS.some((kw) => bizType.includes(kw));
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

/** 
 * 주소 일치율 1:1 검증 
 * 도로명("영등포로")이 동일할 경우, 행정동/법정동 경계 표기 차이(영등포동3가 vs 영등포동5가)와 관계없이
 * 건물 번호 차이가 20 이내이면 동일 매장으로 100% 인정!
 */
function isAddressMatched(dbAddr: string, officialAddr: string): boolean {
  if (!dbAddr || !officialAddr) return true;

  const dbRoad = extractRoadName(dbAddr);
  const offRoad = extractRoadName(officialAddr);
  const dbNum = extractBuildingNum(dbAddr);
  const offNum = extractBuildingNum(officialAddr);

  // 1. 도로명이 동일한 경우 건물 번호 차이(<= 20) 최우선 매칭
  if (dbRoad && offRoad && dbRoad === offRoad) {
    if (!dbNum || !offNum) return true;
    if (Math.abs(Number(dbNum) - Number(offNum)) <= 20) {
      return true;
    }
  }

  // 2. 법정동 일치 확인
  const dbDong = extractDong(dbAddr);
  const offDong = extractDong(officialAddr);
  if (dbDong && offDong && dbDong === offDong) {
    return true;
  }

  return false;
}

function generateQueryVariants(name: string): string[] {
  const list: string[] = [];

  let clean1 = name
    .replace(/\(주\)|\(유\)|주식회사/g, "")
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, "")
    .replace(/(영등포|문래|당산|여의도|타임스퀘어|신길|대림|양평|도림)?\s*(시장점|역점|본점|직영점|[0-9]+호점|점)$/g, "")
    .trim();
  list.push(clean1);

  const noSpace = clean1.replace(/\s+/g, "");
  if (noSpace) list.push(noSpace);

  list.push(`${clean1}식당`);
  list.push(`${clean1}맛집`);

  let variant = clean1
    .replace(/천씨씨/g, "1000cc")
    .replace(/서브웨이/g, "써브웨이")
    .replace(/삼삼/g, "33")
    .replace(/[a-zA-Z0-9]/g, "");
  if (variant) list.push(variant.replace(/\s+/g, ""));

  const koreanWords = clean1.match(/[\uAC00-\uD7A3]+/g) ?? [];
  for (const w of koreanWords) {
    if (w.length >= 2) list.push(w.slice(0, 4));
  }

  return [...new Set(list)].filter((q) => q && q.length >= 2);
}

export async function checkZeroPayOfficial(
  merchantName: string,
  dbAddress?: string,
  existingContext?: BrowserContext
): Promise<ZeroPayOfficialCheckResult> {
  const isOwnContext = !existingContext;
  const browser = isOwnContext ? await chromium.launch({ headless: true }) : null;
  const context = existingContext ?? (await browser!.newContext({ locale: "ko-KR" }));
  const page = await context.newPage();

  let isZeroPay = false;
  let officialName: string | undefined;
  let officialAddress: string | undefined;
  let bizType: string | undefined;
  let isNotFoodBiz = false;

  try {
    await page.goto("https://www.zeropay.or.kr/UI_HP_009_03.act", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(1000);

    const variants = generateQueryVariants(merchantName);

    for (const queryKey of variants) {
      const list: any[] = await page.evaluate(async (q) => {
        return new Promise((resolve) => {
          const win = window as any;
          if (typeof win.comAjax === "function") {
            const reqParm = {
              AFLT_ADDR_CITY: "서울특별시",
              AFLT_ADDR_CITY_SIMPLE: "서울",
              AFLT_ADDR_GU: "영등포구",
              AFLT_NM: q,
              AFLT_ROAD_ADDR: "",
              BIZ_TYPE_CD: "",
              TRX_TP: "01",
            };
            win.comAjax("UI_HP_009_03", reqParm, (data: any) => {
              resolve(data?.LIST2 ?? []);
            }, () => resolve([]), false);
          } else {
            resolve([]);
          }
        });
      }, queryKey);

      if (list.length > 0) {
        const matched = list.find((item: any) => {
          const itemAddr = item.AFLT_ROAD_ADDR ?? "";
          return isAddressMatched(dbAddress ?? "", itemAddr);
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
    await page.close();
    if (isOwnContext && browser) {
      await browser.close();
    }
  }

  return { isZeroPay, officialName, officialAddress, bizType, isNotFoodBiz };
}
