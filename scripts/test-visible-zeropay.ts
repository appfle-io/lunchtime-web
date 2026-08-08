import { chromium } from 'playwright';

async function testVisibleBrowser() {
  // headless: false 로 브라우저 화면이 실제로 눈앞에 뜨도록 설정!
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();

  console.log('=== 눈으로 보는 제로페이 공식 조회 테스트 (headless: false) ===\n');

  await page.goto('https://www.zeropay.or.kr/UI_HP_009_03.act', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const testStores = [
    { name: '소림마라 영등포점', query: '소림마라' },
    { name: '써브웨이 문래점', query: '써브웨이' },
    { name: '아웃백스테이크하우스 타임스퀘어점', query: '아웃백' },
    { name: '스타벅스 영등포구청역점', query: '스타벅스' }
  ];

  for (const store of testStores) {
    const list: any[] = await page.evaluate(async (q) => {
      return new Promise((resolve) => {
        const win = window as any;
        win.comAjax('UI_HP_009_03', {
          AFLT_ADDR_CITY: '서울특별시',
          AFLT_ADDR_CITY_SIMPLE: '서울',
          AFLT_ADDR_GU: '영등포구',
          AFLT_NM: q,
          AFLT_ROAD_ADDR: '',
          BIZ_TYPE_CD: '',
          TRX_TP: '01'
        }, (data: any) => resolve(data?.LIST2 ?? []), () => resolve([]), false);
      });
    }, store.query);

    const isZeroPay = list.length > 0;
    console.log(`[조회] "${store.name}" (검색어: "${store.query}")`);
    console.log(` └ 제로페이 공식 응답 개수: ${list.length}개`);
    console.log(` └ 최종 결과: ${isZeroPay ? '🟢 제로페이 가맹점 맞아!' : '🔴 미가맹점 (false)'}`);
    if (isZeroPay) {
      console.log(`   공식상호: ${list[0].AFLT_NM} | 주소: ${list[0].AFLT_ROAD_ADDR}`);
    }
    console.log('');
    await page.waitForTimeout(1500);
  }

  await browser.close();
  process.exit(0);
}

testVisibleBrowser().catch(console.error);
