import { chromium } from 'playwright';

async function testExactGugunSearch() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();

  await page.goto('https://www.zeropay.or.kr/UI_HP_009_03.act', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const targets = [
    { raw: '하루국시101 영등포점', query: '하루국시' },
    { raw: '밥프로밥pro', query: '밥프로' },
    { raw: '왓더버거 영등포점', query: '왓더버거' },
    { raw: '디톡시', query: '디톡시' },
    { raw: '송죽장', query: '송죽장' },
    { raw: '루루도넛', query: '루루' },
    { raw: '예가원', query: '예가원' },
    { raw: '장수본가해장국 영등포 시장점', query: '장수본가' },
    { raw: '아웃백스테이크하우스 타임스퀘어점', query: '아웃백' },
    { raw: '스타벅스 영등포구청역점', query: '스타벅스' }
  ];

  console.log('=== Yeongdeungpo-gu Fixed + Fuzzy Keyword Search Test ===\n');

  for (const item of targets) {
    const list: any[] = await page.evaluate(async (q) => {
      return new Promise((resolve) => {
        const win = window as any;
        if (typeof win.comAjax === 'function') {
          const reqParm = {
            AFLT_ADDR_CITY: '서울특별시',
            AFLT_ADDR_CITY_SIMPLE: '서울',
            AFLT_ADDR_GU: '영등포구',
            AFLT_NM: q,
            AFLT_ROAD_ADDR: '',
            BIZ_TYPE_CD: '',
            TRX_TP: '01'
          };
          win.comAjax('UI_HP_009_03', reqParm, (data: any) => {
            resolve(data?.LIST2 ?? []);
          }, () => resolve([]), false);
        } else {
          resolve([]);
        }
      });
    }, item.query);

    const isZeroPay = list.length > 0;
    console.log(`Original: "${item.raw}" | Query: "${item.query}"`);
    console.log(` -> Status: ${isZeroPay ? '🟢 ZeroPay Merchant' : '🔴 Not ZeroPay'}`);
    if (isZeroPay) {
      console.log(`    Matches: ${list.length} stores | First: ${list[0].AFLT_NM} (${list[0].AFLT_ROAD_ADDR})`);
    }
    console.log('');
  }

  await browser.close();
  process.exit(0);
}

testExactGugunSearch().catch(console.error);
