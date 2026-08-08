import { chromium } from 'playwright';

async function checkOfficialZeroPayMerchant(merchantName: string): Promise<{ isZeroPay: boolean; matchedName?: string; matchedAddr?: string }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();

  let isZeroPay = false;
  let matchedName: string | undefined;
  let matchedAddr: string | undefined;

  page.on('response', async (res) => {
    if (res.url().includes('UI_HP_009_02.jct')) {
      try {
        const json = await res.json();
        const list = json?.LIST1 ?? [];
        if (list.length > 0) {
          isZeroPay = true;
          matchedName = list[0].AFFI_MCHT_NM;
          matchedAddr = list[0].ADRS_1;
        }
      } catch (_) {}
    }
  });

  try {
    await page.goto('https://www.zeropay.or.kr/UI_HP_009_03.act', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500);

    const input = await page.$('input#iptText');
    if (input) {
      await input.fill(merchantName);

      // 검색 버튼 클릭 (a 태그 또는 button)
      const btn = await page.$('.btn_search, a.btn_search, button:has-text("검색"), a:has-text("검색")');
      if (btn) {
        await btn.click();
        await page.waitForTimeout(2500);
      }
    }
  } catch (e) {
    console.error(`Error checking ${merchantName}:`, (e as Error).message);
  } finally {
    await browser.close();
  }

  return { isZeroPay, matchedName, matchedAddr };
}

async function main() {
  const testList = [
    '아웃백',
    '스타벅스',
    '동남집',
    '호박집',
    '소소한날',
    '맥도날드',
    '옥된장'
  ];

  console.log('=== OFFICIAL ZERO-PAY MERCHANT VERIFICATION TEST ===\n');

  for (const name of testList) {
    const res = await checkOfficialZeroPayMerchant(name);
    console.log(`[Official ZeroPay Check] "${name}" -> ${res.isZeroPay ? '🟢 제로페이 가맹점' : '🔴 미가맹점'}`);
    if (res.isZeroPay) {
      console.log(`   └ 상호: ${res.matchedName} | 주소: ${res.matchedAddr}`);
    }
  }
}

main().catch(console.error);
