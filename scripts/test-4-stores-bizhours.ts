import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface BizHoursTestResult {
  storeName: string;
  placeId: string;
  rawLines: string[];
  formattedText: string | null;
}

const TEST_STORES = [
  { name: '송죽장', placeId: '1265614058' },
  { name: '하루국시101 영등포점', placeId: '37841977' },
  { name: '3일한우국밥', placeId: '37379272' },
  { name: '디톡시', placeId: '38431209' },
];

async function scrapeBizHoursForStore(storeName: string, placeId: string, page: any): Promise<BizHoursTestResult> {
  console.log(`\n==================================================`);
  console.log(`🔍 [영업시간 수집 테스트] ${storeName} (placeId: ${placeId})`);

  // 네이버 지도 PC/모바일 상세페이지 진입
  const homeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
  await page.goto(homeUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 펼쳐보기 버튼이 있으면 클릭
  const expandBtns = await page.$$('a[role="button"], button, div[class*="overflow"]');
  for (const btn of expandBtns) {
    const text = await btn.innerText().catch(() => '');
    if (text.includes('펼쳐보기') || text.includes('영업')) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1000);
      break;
    }
  }

  const rawLines = await page.evaluate(() => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    const apolloLines: string[] = [];

    // 1. Apollo State 탐색
    for (const k of Object.keys(apollo)) {
      const v = apollo[k];
      if (v && (v.businessHours || v.bizHours || v.periodList || v.bizHourList)) {
        const list = v.businessHours || v.bizHours || v.periodList || v.bizHourList;
        if (Array.isArray(list)) {
          for (const item of list) {
            if (typeof item === 'string') apolloLines.push(item);
            else if (item && typeof item === 'object') {
              const day = item.day || item.dayOfWeek || item.title || '';
              const time = item.time || item.hours || item.businessHours || '';
              if (day || time) apolloLines.push(`${day} ${time}`.trim());
            }
          }
        }
      }
    }

    if (apolloLines.length > 0) return apolloLines;

    // 2. DOM 텍스트 파싱
    const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const result: string[] = [];
    let capturing = false;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (
        l.includes('영업 종료') ||
        l.includes('영업 중') ||
        l.includes('운영시간') ||
        l.includes('영업시간') ||
        l.includes('24시간 영업') ||
        l.includes('연중무휴') ||
        l.includes('매일')
      ) {
        capturing = true;
      }
      if (capturing) {
        if (
          l.includes('24시간') ||
          l.includes('연중무휴') ||
          l.startsWith('매일') ||
          l.startsWith('월') ||
          l.startsWith('화') ||
          l.startsWith('수') ||
          l.startsWith('목') ||
          l.startsWith('금') ||
          l.startsWith('토') ||
          l.startsWith('일') ||
          l.includes('00:00') ||
          l.includes('아이스크림') ||
          l.includes('라스트오더') ||
          l.includes('브레이크타임')
        ) {
          if (!result.includes(l) && !l.includes('수정 제안')) result.push(l);
        }
        if (l.includes('전화번호') || l.includes('편의') || l.includes('주소') || l.includes('생방송')) break;
      }
    }
    return result;
  });

  const formattedText = rawLines.length > 0 ? rawLines.join('\n') : null;
  console.log(`  🍱 파싱된 라인 수: ${rawLines.length}개`);
  if (formattedText) {
    console.log(`  📝 파싱된 결과:\n${formattedText.split('\n').map((l: string) => '     ' + l).join('\n')}`);
  } else {
    console.log(`  ⚪ 영업시간 정보 없음`);
  }

  return {
    storeName,
    placeId,
    rawLines,
    formattedText,
  };
}

async function main() {
  const { db } = await import('../src/lib/firebase');
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  const results: BizHoursTestResult[] = [];

  for (const store of TEST_STORES) {
    const res = await scrapeBizHoursForStore(store.name, store.placeId, page);
    results.push(res);

    // DB 업데이트
    const snap = await restaurantsRef.where('name', '==', store.name).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({
        businessHours: res.formattedText
      });
      console.log(`  ✅ Firestore DB 영업시간 필드 커밋 완수 (${snap.docs[0].id})`);
    }
  }

  await browser.close();

  console.log('\n==================================================');
  console.log('🎉 [샘플 4개 매장 영업시간 수집 테스트 결과 최종 리포트]');
  console.log('==================================================');
  for (const r of results) {
    console.log(`\n📌 식당명: ${r.storeName}`);
    if (r.formattedText) {
      console.log(r.formattedText.split('\n').map(line => '   ' + line).join('\n'));
    } else {
      console.log('   (영업시간 정보 미기재/없음)');
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
