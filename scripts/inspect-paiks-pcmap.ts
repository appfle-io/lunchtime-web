import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectPaiksPcmapInfo() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [PCMAP info 분석] 빽다방 영등포시장사거리점 (1550985472) https://pcmap.place.naver.com/restaurant/1550985472/info 접속...');
  await page.goto('https://pcmap.place.naver.com/restaurant/1550985472/info', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // 펼쳐보기 버튼이 있으면 클릭
  const buttons = await page.$$('button, a, div[role="button"]');
  for (const btn of buttons) {
    const text = await btn.innerText().catch(() => '');
    if (text.includes('펼쳐보기') || text.includes('영업시간')) {
      console.log(`👉 펼쳐보기 클릭: ${text.replace(/\n/g, ' ')}`);
      await btn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // Apollo State 확인
  const apolloData = await page.evaluate(() => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    const keys = Object.keys(apollo);
    const bizObj: any[] = [];
    for (const k of keys) {
      const v = apollo[k];
      if (k.toLowerCase().includes('bizhour') || k.toLowerCase().includes('period') || (v && (v.businessHours || v.bizHours || v.periodList))) {
        bizObj.push({ key: k, value: v });
      }
    }
    return { keysCount: keys.length, bizObj };
  });

  console.log(`📌 Apollo State 총 키 수: ${apolloData.keysCount}, bizObj:`, JSON.stringify(apolloData.bizObj, null, 2));

  // 전체 DOM 텍스트 확인
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('\n--- PCMAP Info body text ---');
  const lines = bodyText.split('\n').map(s => s.trim()).filter(Boolean);
  lines.forEach((l, idx) => {
    if (l.includes('영업') || l.includes('월') || l.includes('화') || l.includes('수') || l.includes('목') || l.includes('금') || l.includes('토') || l.includes('일') || l.includes('라스트오더')) {
      console.log(`  [${idx}] ${l}`);
    }
  });

  await browser.close();
}

inspectPaiksPcmapInfo().catch(console.error);
