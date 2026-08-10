import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  // 모바일 디톡시 네이버 맵 진입
  await page.goto('https://m.place.naver.com/restaurant/38431209/menu/list', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // [매장] 탭 버튼 탐색 및 클릭
  const buttons = await page.$$('button, a');
  for (const btn of buttons) {
    const text = await btn.innerText().catch(() => '');
    if (text.trim() === '매장') {
      console.log('Found [매장] button, clicking...');
      await btn.click().catch(() => {});
      await page.waitForTimeout(2500);
      break;
    }
  }

  // 렌더링된 매장 탭 메뉴 목록 정밀 수집
  const scrapedMenus = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

    const items: Array<{ name: string; price: string; description: string; image: string | null }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.endsWith('원') && line.length < 15) {
        // 이전 줄이 메뉴명
        let name = lines[i - 1] || '';
        if (name === '대표' || name === '인기') {
          name = lines[i - 2] || '';
        }
        if (name && !name.includes('주문') && !name.includes('품절') && name.length < 30) {
          items.push({
            name,
            price: line,
            description: '',
            image: null // 화면 렌더링 이미지 유무
          });
        }
      }
    }

    return {
      rawLinesCount: lines.length,
      sampleLines: lines.slice(0, 35),
      parsedMenus: items
    };
  });

  console.log('=== 디톡시 [매장] 탭 실제 파싱 결과 ===\n', JSON.stringify(scrapedMenus, null, 2));

  await browser.close();
  process.exit(0);
}

main().catch(console.error);
