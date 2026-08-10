import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectDetoxiNorderStructure() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [정밀분석] PC버전 네이버 맵 디톡시 booking 페이지 진입...');
  await page.goto('https://map.naver.com/p/entry/place/38431209?c=15.00,0,0,0,dh', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(4000);

  // iframe 들 탐색
  const frames = page.frames();
  console.log(`📌 현재 총 iframe 수: ${frames.length}개`);
  for (const frame of frames) {
    const url = frame.url();
    console.log(`  - iframe URL: ${url}`);
  }

  // searchIframe 또는 entryIframe 탐색
  const entryFrame = frames.find(f => f.url().includes('entry/place/38431209') || f.url().includes('place/38431209'));
  if (entryFrame) {
    console.log('\n✅ entryIframe 발견! 내부에 스마트주문/메뉴/예약 탭 클릭 탐색...');
    const tabs = await entryFrame.$$('a, button');
    for (const tab of tabs) {
      const text = await tab.innerText().catch(() => '');
      if (text.includes('메뉴') || text.includes('주문') || text.includes('예약')) {
        console.log(`  - 탭 텍스트: "${text.replace(/\n/g, ' ')}"`);
      }
    }

    // 메뉴/주문 탭 클릭 시도
    for (const tab of tabs) {
      const text = await tab.innerText().catch(() => '');
      if (text.includes('메뉴') || text.includes('주문')) {
        console.log(`👉 탭 클릭: "${text.replace(/\n/g, ' ')}"`);
        await tab.click().catch(() => {});
        await page.waitForTimeout(3000);
        break;
      }
    }

    const frameText = await entryFrame.evaluate(() => document.body.innerText);
    console.log('\n--- entryFrame 텍스트 샘플 (상위 500자) ---');
    console.log(frameText.slice(0, 500));
  }

  await browser.close();
}

inspectDetoxiNorderStructure().catch(console.error);
