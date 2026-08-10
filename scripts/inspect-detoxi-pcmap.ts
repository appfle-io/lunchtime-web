import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectDetoxiPcmap() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [Direct PCMAP] https://pcmap.place.naver.com/restaurant/38431209/booking 접속...');
  await page.goto('https://pcmap.place.naver.com/restaurant/38431209/booking', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  const text = await page.evaluate(() => document.body.innerText);
  console.log('--- pcmap booking page text (length: ' + text.length + ') ---');
  console.log(text.slice(0, 1500));

  console.log('\n🔍 [Direct PCMAP] https://pcmap.place.naver.com/restaurant/38431209/menu/list 접속...');
  await page.goto('https://pcmap.place.naver.com/restaurant/38431209/menu/list', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  const menuText = await page.evaluate(() => document.body.innerText);
  console.log('--- pcmap menu/list page text (length: ' + menuText.length + ') ---');
  console.log(menuText.slice(0, 1500));

  await browser.close();
}

inspectDetoxiPcmap().catch(console.error);
