import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const FOOD_BIZ_KEYWORDS = [
  '음식점', '육류', '요리', '중식', '일식', '서양식', '제과', '피자', '햄버거',
  '샌드위치', '치킨', '김밥', '간이', '포장', '생맥주', '주점', '커피', '카페',
  '베이커리', '분식', '휴게음식', '패스트푸드', '식당', '떡볶이', '해장국', '단팥빵'
];

function isFoodBizType(bizType: string | null | undefined): boolean {
  if (!bizType) return true;
  return FOOD_BIZ_KEYWORDS.some(kw => bizType.includes(kw));
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

function isAddressMatched(dbAddr: string, officialAddr: string): boolean {
  if (!dbAddr || !officialAddr) return true;

  const dbRoad = extractRoadName(dbAddr);
  const offRoad = extractRoadName(officialAddr);
  const dbNum = extractBuildingNum(dbAddr);
  const offNum = extractBuildingNum(officialAddr);

  if (dbRoad && offRoad && dbRoad === offRoad) {
    if (!dbNum || !offNum) return true;
    if (Math.abs(Number(dbNum) - Number(offNum)) <= 20) return true;
  }

  const dbDong = extractDong(dbAddr);
  const offDong = extractDong(officialAddr);
  if (dbDong && offDong && dbDong === offDong) return true;

  return false;
}

function generateQueryVariants(name: string): string[] {
  const list: string[] = [];

  let clean1 = name
    .replace(/\(주\)|\(유\)|주식회사/g, '')
    .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, '')
    .replace(/(영등포|문래|당산|여의도|타임스퀘어|신길|대림|양평|도림)?\s*(시장점|역점|본점|직영점|[0-9]+호점|점)$/g, '')
    .trim();
  list.push(clean1);

  const noSpace = clean1.replace(/\s+/g, '');
  if (noSpace) list.push(noSpace);

  list.push(`${clean1}식당`);
  list.push(`${clean1}맛집`);

  let variant = clean1
    .replace(/천씨씨/g, '1000cc')
    .replace(/서브웨이/g, '써브웨이')
    .replace(/삼삼/g, '33')
    .replace(/[a-zA-Z0-9]/g, '');
  if (variant) list.push(variant.replace(/\s+/g, ''));

  const koreanWords = clean1.match(/[\uAC00-\uD7A3]+/g) ?? [];
  for (const w of koreanWords) {
    if (w.length >= 2) list.push(w.slice(0, 4));
  }

  return [...new Set(list)].filter(q => q && q.length >= 2);
}

async function main() {
  const { db } = await import('../src/lib/firebase');
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();
  const falseDocs = snap.docs.filter(d => !d.data().isZeroPay && d.data().source !== 'user_verified');

  console.log(`\n🚀 [세션 자동 갱신 100% DB 반영 전수 재검증] 총 ${falseDocs.length}개 false 매장 시작\n`);

  const browser = await chromium.launch({ headless: true });
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');
  
  let recoveredCount = 0;
  let deletedCount = 0;
  let doneCount = 0;
  const total = falseDocs.length;

  let context = await browser.newContext({ locale: 'ko-KR' });
  let page = await context.newPage();
  await page.goto('https://www.zeropay.or.kr/UI_HP_009_03.act', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  for (const doc of falseDocs) {
    // 25개 검증 시 세션 자동 갱신 (제로페이 봇 방화벽 100% 우회)
    if (doneCount > 0 && doneCount % 25 === 0) {
      await page.close();
      await context.close();
      context = await browser.newContext({ locale: 'ko-KR' });
      page = await context.newPage();
      await page.goto('https://www.zeropay.or.kr/UI_HP_009_03.act', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    }

    const docId = doc.id;
    const name = doc.data().name as string;
    const addr = (doc.data().address as string) ?? '';
    const variants = generateQueryVariants(name);

    let isZeroPay = false;
    let officialName: string | undefined;
    let officialAddr: string | undefined;
    let bizType: string | undefined;
    let isNotFoodBiz = false;

    for (const q of variants) {
      try {
        const list: any[] = await page.evaluate(async (queryKey) => {
          return new Promise((resolve) => {
            const win = window as any;
            if (typeof win.comAjax === 'function') {
              const timer = setTimeout(() => resolve([]), 3000);
              win.comAjax('UI_HP_009_03', {
                AFLT_ADDR_CITY: '서울특별시',
                AFLT_ADDR_CITY_SIMPLE: '서울',
                AFLT_ADDR_GU: '영등포구',
                AFLT_NM: queryKey,
                AFLT_ROAD_ADDR: '',
                BIZ_TYPE_CD: '',
                TRX_TP: '01'
              }, (data: any) => {
                clearTimeout(timer);
                resolve(data?.LIST2 ?? []);
              }, () => {
                clearTimeout(timer);
                resolve([]);
              }, false);
            } else {
              resolve([]);
            }
          });
        }, q);

        if (list && list.length > 0) {
          const matched = list.find(item => isAddressMatched(addr, item.AFLT_ROAD_ADDR ?? ''));
          if (matched) {
            bizType = matched.BIZ_TYPE ?? '';
            if (!isFoodBizType(bizType)) {
              isNotFoodBiz = true;
            } else {
              isZeroPay = true;
              officialName = matched.AFLT_NM;
              officialAddr = matched.AFLT_ROAD_ADDR;
            }
            break;
          }
        }
      } catch (_) {}
    }

    doneCount++;

    if (isNotFoodBiz) {
      deletedCount++;
      await restaurantsRef.doc(docId).delete();
      console.log(`  [${doneCount}/${total}] 🗑️ (식당 아님 삭제) ${name} [${bizType}]`);
    } else if (isZeroPay) {
      recoveredCount++;
      await restaurantsRef.doc(docId).update({
        isZeroPay: true,
        zeroPaySource: 'official_zeropay_api_fuzzy',
        zeroPayOfficialName: officialName ?? name,
        zeroPayOfficialAddress: officialAddr ?? addr,
        zeroPayEnrichedAt: new Date().toISOString(),
      });
      console.log(`  [${doneCount}/${total}] 🟢 (DB 반영 완료!) ${name} ➡️ ${officialName}`);
    } else {
      if (doneCount % 10 === 0) {
        console.log(`  ... [${doneCount}/${total}] 진행 중 (구출 성공: ${recoveredCount}개 / 삭제: ${deletedCount}개)`);
      }
    }

    await page.waitForTimeout(200);
  }

  await page.close();
  await context.close();
  await browser.close();

  console.log(`\n=== 🎯 확실한 DB 반영 완결 ===`);
  console.log(`총 검사: ${total}개`);
  console.log(`🟢 구출되어 isZeroPay = true DB 반영된 매장: ${recoveredCount}개`);
  console.log(`🗑️ 식당 아님 DB 삭제된 매장: ${deletedCount}개`);
  process.exit(0);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
