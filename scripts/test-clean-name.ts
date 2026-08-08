import { chromium } from 'playwright';

function cleanMerchantName(name: string): string {
  return name
    .replace(/\(주\)|\(유\)|주식회사/g, '')
    .replace(/(영등포|문래|당산|여의도|타임스퀘어|신길|대림|양평|도림)?\s*(시장점|역점|본점|직영점|[0-9]+호점|점)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function testSampleValidation() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();

  const samples = [
    '하루국시101 영등포점',
    '디톡시',
    '송죽장',
    '루루도넛',
    '예가원',
    '장수본가해장국 영등포 시장점',
    '아웃백스테이크하우스 타임스퀘어점',
    '스타벅스 영등포구청역점'
  ];

  await page.goto('https://www.zeropay.or.kr/UI_HP_009_03.act', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  console.log('=== Improved Algorithm Sample Validation Test ===\n');

  for (const rawName of samples) {
    const cleaned = cleanMerchantName(rawName);
    let matchedList: any[] = [];

    const responseHandler = async (res: any) => {
      if (res.url().includes('UI_HP_009_02.jct')) {
        try {
          const json = await res.json();
          matchedList = json?.LIST1 ?? [];
        } catch (_) {}
      }
    };

    page.on('response', responseHandler);

    await page.evaluate((queryName) => {
      const win = window as any;
      const input = document.querySelector('input#iptText') as HTMLInputElement;
      if (input && win._thisPage) {
        input.value = queryName;
        if (typeof win._thisPage.setParm === 'function') win._thisPage.setParm('01');
        if (typeof win._thisPage.search === 'function') win._thisPage.search();
      }
    }, cleaned);

    await page.waitForTimeout(2500);
    page.off('response', responseHandler);

    const isZeroPay = matchedList.length > 0;

    console.log(`Original: "${rawName}" -> Cleaned: "${cleaned}"`);
    console.log(` -> Status: ${isZeroPay ? '🟢 ZeroPay Merchant' : '🔴 Not ZeroPay'}`);
    if (isZeroPay) {
      console.log(`    Matched: ${matchedList[0].AFFI_MCHT_NM} | ${matchedList[0].ADRS_1}`);
    }
    console.log('');
  }

  await browser.close();
  process.exit(0);
}

testSampleValidation().catch(console.error);
