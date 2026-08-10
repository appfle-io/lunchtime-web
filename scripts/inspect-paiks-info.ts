import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectPaiksInfoPage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [정보탭 분석] 빽다방 영등포시장사거리점 (1550985472) /information 접속...');
  await page.goto('https://m.place.naver.com/restaurant/1550985472/information', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // 펼쳐보기 버튼이 있으면 클릭
  const buttons = await page.$$('button, a');
  for (const btn of buttons) {
    const text = await btn.innerText().catch(() => '');
    if (text.includes('펼쳐보기') || text.includes('영업시간')) {
      console.log(`👉 클릭 시도: ${text.replace(/\n/g, ' ')}`);
      await btn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // Apollo State 확인
  const apolloData = await page.evaluate(() => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    const bizHours: any[] = [];
    for (const k of Object.keys(apollo)) {
      const v = apollo[k];
      if (k.includes('BizHour') || k.includes('BusinessHour') || (v && v.businessHours)) {
        bizHours.push({ key: k, value: v });
      }
    }
    return { keysCount: Object.keys(apollo).length, bizHours };
  });

  console.log(`📌 Apollo State 총 키 수: ${apolloData.keysCount}, bizHours:`, JSON.stringify(apolloData.bizHours, null, 2));

  // DOM 텍스트 파싱
  const textLines = await page.evaluate(() => {
    const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const bizLines: string[] = [];
    let start = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('영업시간') || line.includes('영업 종료') || line.includes('영업 시작')) {
        start = true;
      }
      if (start) {
        bizLines.push(line);
        if (bizLines.length > 25) break;
      }
    }
    return bizLines;
  });

  console.log('📌 DOM 텍스트 추출 결과:', textLines);

  await browser.close();
}

inspectPaiksInfoPage().catch(console.error);
