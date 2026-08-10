import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface BizHoursResult {
  storeName: string;
  placeId: string;
  bizHoursText: string | null;
}

const TEST_STORES = [
  { name: '송죽장', placeId: '1265614058' },
  { name: '하루국시101 영등포점', placeId: '37841977' },
  { name: '3일한우국밥', placeId: '37379272' },
  { name: '디톡시', placeId: '38431209' },
];

async function parseMobileBizHoursExact(page: any, placeId: string, storeName: string): Promise<BizHoursResult> {
  console.log(`\n==================================================`);
  console.log(`🔍 [모바일 영업시간 짝지기 정밀 수집] ${storeName} (${placeId})`);

  const mobileUrl = `https://m.place.naver.com/restaurant/${placeId}/home`;
  await page.goto(mobileUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 영업시간 영역 클릭 (펼쳐보기)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('a, button, div, span'));
    for (const b of btns) {
      const txt = b.textContent || '';
      if (txt.includes('영업시간') || txt.includes('영업 종료') || txt.includes('영업 중') || txt.includes('24시간 영업') || txt.includes('영업 시작')) {
        (b as HTMLElement).click();
      }
    }
  });

  await page.waitForTimeout(1500);

  // 요일과 시간을 1:1 매칭하는 DOM 짝지기 파서
  const parsedLines = await page.evaluate(() => {
    const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const results: string[] = [];
    let isInsideBizSection = false;
    let bizSectionLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '영업시간') {
        isInsideBizSection = true;
        continue;
      }
      if (isInsideBizSection) {
        if (line === '접기' || line.includes('영업시간 수정 제안') || line === '전화번호' || line === 'TV방송정보' || line === '편의') {
          break;
        }
        bizSectionLines.push(line);
      }
    }

    // 요일 + 시간 조합 짝지기
    let idx = 0;
    while (idx < bizSectionLines.length) {
      const cur = bizSectionLines[idx];
      const next = bizSectionLines[idx + 1] || '';

      // 매일 / 요일 시작 조건
      if (cur.startsWith('매일') || ['월', '화', '수', '목', '금', '토', '일'].some(d => cur.startsWith(d))) {
        if (next && (next.includes(':') || next.includes('-') || next.includes('영업') || next.includes('정기휴무') || next.includes('휴무'))) {
          results.push(`${cur} ${next}`);
          idx += 2;
          continue;
        } else {
          results.push(cur);
        }
      } else if (cur.includes('브레이크') || cur.includes('마감') || cur.includes('라스트') || cur.includes('24시간') || cur.includes('연중무휴') || cur.startsWith('-')) {
        if (!results.includes(cur)) results.push(cur);
      }
      idx++;
    }

    return results;
  });

  const bizHoursText = parsedLines.length > 0 ? parsedLines.join('\n') : null;
  console.log(`  🍱 정밀 파싱 완료 (${parsedLines.length}줄)`);

  return {
    storeName,
    placeId,
    bizHoursText
  };
}

async function main() {
  const { db } = await import('../src/lib/firebase');
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  const finalResults: BizHoursResult[] = [];

  for (const store of TEST_STORES) {
    const res = await parseMobileBizHoursExact(page, store.placeId, store.name);
    finalResults.push(res);

    // Firestore DB 커밋
    const snap = await restaurantsRef.where('name', '==', store.name).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({
        businessHours: res.bizHoursText
      });
      console.log(`  ✅ Firestore DB 영업시간 필드 커밋 완수 (${snap.docs[0].id})`);
    }
  }

  await browser.close();

  console.log('\n==================================================');
  console.log('🎉 [샘플 4개 매장 네이버 맵 100% 동일 영업시간 수집 리포트]');
  console.log('==================================================');
  for (const r of finalResults) {
    console.log(`\n📌 식당명: ${r.storeName}`);
    if (r.bizHoursText) {
      console.log(r.bizHoursText.split('\n').map(l => '   ' + l).join('\n'));
    } else {
      console.log('   (영업시간 정보 없음)');
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
