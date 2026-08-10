import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectSongjukjangText() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  await page.goto('https://m.place.naver.com/restaurant/1265614058/home', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // 펼치기 버튼 클릭 시도 (아이콘 div 등)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('a, button, div, span'));
    for (const b of btns) {
      if (b.textContent?.includes('영업') || b.textContent?.includes('11:00')) {
        (b as HTMLElement).click();
      }
    }
  });

  await page.waitForTimeout(1500);

  const lines = await page.evaluate(() => {
    return (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
  });

  console.log('📌 송죽장 전체 body lines (상위 50개):');
  lines.slice(0, 60).forEach((l, i) => console.log(`  [${i}] ${l}`));

  await browser.close();
}

inspectSongjukjangText().catch(console.error);
