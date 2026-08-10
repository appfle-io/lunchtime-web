import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectPaiksBusinessHours() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [영업시간 분석] 빽다방 영등포시장사거리점 (1550985472) 모바일 홈 진입...');
  await page.goto('https://m.place.naver.com/restaurant/1550985472/home', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // 1. Apollo State 키 조사
  const apolloBizHours = await page.evaluate(() => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    const found: any[] = [];
    for (const k of Object.keys(apollo)) {
      if (k.toLowerCase().includes('biz') || k.toLowerCase().includes('hour') || k.toLowerCase().includes('time')) {
        found.push({ key: k, value: apollo[k] });
      }
    }
    return found;
  });

  console.log('📌 Apollo State 관련 키:', JSON.stringify(apolloBizHours, null, 2));

  // 2. DOM 텍스트 영업시간 추출 시도
  const domBizHours = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const results: string[] = [];
    let capturing = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('영업시간') || line.includes('영업 시작') || line.includes('영업 종료') || line.includes('운영시간')) {
        capturing = true;
      }
      if (capturing) {
        results.push(line);
        if (results.length > 15) break;
      }
    }
    return results;
  });

  console.log('📌 DOM 영업시간 파싱 샘플:', domBizHours);

  await browser.close();
}

inspectPaiksBusinessHours().catch(console.error);
