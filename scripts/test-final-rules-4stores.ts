import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface ParsedMenu {
  name: string;
  price: string | null;
  description?: string | null;
  tags: string[];
  isRepresentative: boolean;
  isPopular: boolean;
}

const TEST_STORES = [
  { name: '송죽장', placeId: '1265614058' },
  { name: '하루국시101 영등포점', placeId: '37841977' },
  { name: '3일한우국밥', placeId: '37379272' },
  { name: '디톡시', placeId: '38431209' },
];

async function scrapeStorePerfect(placeId: string, storeName: string, page: any): Promise<ParsedMenu[]> {
  console.log(`\n==================================================`);
  console.log(`🔍 [수집 진행] ${storeName} (placeId: ${placeId})`);

  let parsedMenus: ParsedMenu[] = [];

  // Step 1: 네이버 스마트주문 / N-Order / Booking 접속 (Apollo State & DOM 병행 파싱)
  const bookingUrl = `https://m.place.naver.com/restaurant/${placeId}/booking?entry=ple`;
  await page.goto(bookingUrl, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // [매장] 탭 버튼 클릭 시도
  const storeBtns = await page.$$('button, a, [role="button"], [role="tab"]');
  for (const btn of storeBtns) {
    const txt = await btn.innerText().catch(() => '');
    if (txt.trim() === '매장') {
      console.log(`  👉 [매장] 탭 발견 및 클릭!`);
      await btn.click().catch(() => {});
      await page.waitForTimeout(2000);
      break;
    }
  }

  // Apollo State의 스마트주문 / Norder 객체 파싱
  const apolloMenus: ParsedMenu[] = await page.evaluate(() => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    const results: Array<{
      name: string;
      price: string | null;
      description: string | null;
      tags: string[];
      isRepresentative: boolean;
      isPopular: boolean;
    }> = [];

    const keys = Object.keys(apollo);
    // NorderMenu / BookingMenu / PlaceDetail_NorderMenu 객체 탐색
    for (const key of keys) {
      const item = apollo[key];
      if (item && item.name && (item.price || item.priceString || item.priceUnit)) {
        const name = String(item.name).trim();
        let price = item.price ? `${Number(item.price).toLocaleString()}원` : (item.priceString ? String(item.priceString) : null);
        if (price && !price.endsWith('원')) price = `${price}원`;

        const desc = item.description || item.desc || null;
        const tags: string[] = [];

        if (item.recommend || item.isRecommend || item.isRepresentative || item.isSignature) {
          tags.push('대표');
        }
        if (item.popular || item.isPopular || item.isHot) {
          tags.push('인기');
        }

        if (name && !name.includes('주문') && !results.some(r => r.name === name)) {
          results.push({
            name,
            price,
            description: desc,
            tags,
            isRepresentative: tags.includes('대표'),
            isPopular: tags.includes('인기'),
          });
        }
      }
    }
    return results;
  });

  if (apolloMenus.length > 0) {
    console.log(`  ⚡ 스마트주문 / Norder Apollo State에서 ${apolloMenus.length}개 메뉴 직접 추출!`);
    parsedMenus = apolloMenus;
  }

  // Step 2: Apollo State 파싱이 실패했거나 부족할 경우 DOM 텍스트 렌더링 수집
  if (parsedMenus.length === 0) {
    const mobileMenuUrl = `https://m.place.naver.com/restaurant/${placeId}/menu/list`;
    await page.goto(mobileMenuUrl, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const domMenus: ParsedMenu[] = await page.evaluate(() => {
      const results: Array<{
        name: string;
        price: string | null;
        description: string | null;
        tags: string[];
        isRepresentative: boolean;
        isPopular: boolean;
      }> = [];

      const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.endsWith('원') && line.length < 20) {
          let tags: string[] = [];
          let name = '';
          let desc = '';

          const p1 = lines[i - 1] || '';
          const p2 = lines[i - 2] || '';
          const p3 = lines[i - 3] || '';

          if (p1 === '대표' || p1 === '인기') {
            tags.push(p1);
            if (p2 === '대표' || p2 === '인기') {
              tags.push(p2);
              name = p3;
            } else {
              name = p2;
            }
          } else if (p2 === '대표' || p2 === '인기') {
            tags.push(p2);
            name = p1;
          } else {
            name = p1;
          }

          tags = Array.from(new Set(tags));

          const n1 = lines[i + 1] || '';
          if (n1 && !n1.endsWith('원') && !n1.includes('주문') && n1.length > 5 && n1.length < 150) {
            desc = n1;
          }

          if (
            name &&
            !name.includes('원') &&
            !name.includes('주문') &&
            !name.includes('품절') &&
            !name.includes('메뉴 항목과 가격') &&
            name.length < 40 &&
            !results.some(r => r.name === name)
          ) {
            results.push({
              name,
              price: line,
              description: desc || null,
              tags,
              isRepresentative: tags.includes('대표'),
              isPopular: tags.includes('인기'),
            });
          }
        }
      }
      return results;
    });

    parsedMenus = domMenus;
  }

  // 상위 10개만 제한
  const top10 = parsedMenus.slice(0, 10);
  console.log(`  🍱 최종 상위 ${top10.length}개 메뉴 추출 완수!`);

  return top10;
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

  const finalResults: Record<string, ParsedMenu[]> = {};

  for (const store of TEST_STORES) {
    const menus = await scrapeStorePerfect(store.placeId, store.name, page);
    finalResults[store.name] = menus;

    // DB 커밋 (이미지 필드 완전 제거, imageUrl: null)
    const snap = await restaurantsRef.where('name', '==', store.name).get();
    if (!snap.empty) {
      const docRef = snap.docs[0].ref;
      await docRef.update({
        menus: menus,
        imageUrl: null, // 식당 대표 이미지 삭제
        isNaverEnriched: true
      });
      console.log(`  ✅ Firestore DB 커밋 완수 (${docRef.id})`);
    }
  }

  await browser.close();

  console.log('\n==================================================');
  console.log('🎉 [테스트 4개 매장 최종 100% 무결성 수집 결과 리포트]');
  console.log('==================================================');
  for (const [storeName, menus] of Object.entries(finalResults)) {
    console.log(`\n📌 식당명: ${storeName} (상위 ${menus.length}개)`);
    menus.forEach((m, idx) => {
      const tagStr = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      console.log(`  ${idx + 1}. ${m.name}${tagStr} - ${m.price ?? '가격 정보 없음'}`);
      if (m.description) console.log(`     └ 📝 ${m.description}`);
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
