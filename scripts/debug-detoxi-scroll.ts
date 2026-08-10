import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugDetoxiScroll() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [분석] 디톡시 모바일 스마트주문 페이지 진입...');
  await page.goto('https://m.place.naver.com/restaurant/38431209/booking?entry=ple', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // 매장 탭 클릭
  const storeBtns = await page.$$('button, a, [role="button"], [role="tab"]');
  for (const btn of storeBtns) {
    const txt = await btn.innerText().catch(() => '');
    if (txt.trim() === '매장') {
      console.log('👉 [매장] 탭 클릭');
      await btn.click().catch(() => {});
      await page.waitForTimeout(2000);
      break;
    }
  }

  // 초기 렌더링 상태 스크린샷 & 텍스트
  const initialText = await page.evaluate(() => document.body.innerText);
  console.log('--- [스크롤 전 텍스트 길이] ---', initialText.length);

  // 스크롤을 끝까지 5번 내림
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  const scrolledText = await page.evaluate(() => document.body.innerText);
  console.log('--- [스크롤 후 텍스트 길이] ---', scrolledText.length);

  // 전체 메뉴 파싱
  const allParsedMenus = await page.evaluate(() => {
    const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const results: Array<{ name: string; price: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.endsWith('원') && line.length < 20) {
        const prev1 = lines[i - 1] || '';
        const prev2 = lines[i - 2] || '';
        const prev3 = lines[i - 3] || '';
        let name = prev1;
        if (prev1 === '대표' || prev1 === '인기') {
          name = prev2 === '대표' || prev2 === '인기' ? prev3 : prev2;
        }
        if (name && !name.includes('원') && !name.includes('주문') && !name.includes('품절') && name.length < 40) {
          if (!results.some(r => r.name === name)) {
            results.push({ name, price: line });
          }
        }
      }
    }
    return results;
  });

  console.log(`\n📊 [스크롤 후 총 파싱된 디톡시 메뉴 수: ${allParsedMenus.length}개]`);
  allParsedMenus.forEach((m, idx) => {
    console.log(`  ${idx + 1}. ${m.name} - ${m.price}`);
  });

  await browser.close();
}

debugDetoxiScroll().catch(console.error);
