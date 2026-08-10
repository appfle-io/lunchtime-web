import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugMobileBizHours() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  console.log('🔍 [송죽장 모바일 분석] https://m.place.naver.com/restaurant/1265614058/home 접속...');
  await page.goto('https://m.place.naver.com/restaurant/1265614058/home', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // 영업시간 영역 클릭 (펼쳐보기)
  const clickSuccess = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a, button, div, span'));
    for (const el of elements) {
      const txt = el.textContent || '';
      if (txt.includes('영업 종료') || txt.includes('영업 중') || txt.includes('영업시간')) {
        const clickable = el.closest('a') || el.closest('button') || el;
        (clickable as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  console.log('👉 펼치기 클릭 여부:', clickSuccess);
  await page.waitForTimeout(1500);

  const textLines = await page.evaluate(() => {
    const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const bizLines: string[] = [];
    let capturing = false;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.includes('영업 종료') || l.includes('영업 중') || l.includes('영업시간') || l.includes('24시간 영업')) {
        capturing = true;
      }
      if (capturing) {
        if (
          l.startsWith('매일') ||
          l.startsWith('월') ||
          l.startsWith('화') ||
          l.startsWith('수') ||
          l.startsWith('목') ||
          l.startsWith('금') ||
          l.startsWith('토') ||
          l.startsWith('일') ||
          l.includes('브레이크타임') ||
          l.includes('라스트오더') ||
          l.includes('브레이크 타임') ||
          l.startsWith('-')
        ) {
          if (!bizLines.includes(l) && !l.includes('수정 제안')) {
            bizLines.push(l);
          }
        }
        if (l.includes('전화번호') || l.includes('편의') || l.includes('주소') || l.includes('지하쇼핑센터')) break;
      }
    }
    return bizLines;
  });

  console.log('📌 파싱된 송죽장 영업시간 라인들:', textLines);

  await browser.close();
}

debugMobileBizHours().catch(console.error);
