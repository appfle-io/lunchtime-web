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

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

async function main() {
  const args = process.argv.slice(2);
  const nameArg = args.find(a => a.startsWith('--name='));
  const idArg = args.find(a => a.startsWith('--id='));

  if (!nameArg && !idArg) {
    console.log('사용법: npx tsx scripts/enrich-single-restaurant.ts --name="식당이름"');
    console.log('  또는: npx tsx scripts/enrich-single-restaurant.ts --id="식당문서ID"');
    process.exit(1);
  }

  const searchName = nameArg ? nameArg.split('=')[1].replace(/["']/g, '') : null;
  const searchId = idArg ? idArg.split('=')[1].replace(/["']/g, '') : null;

  const { db } = await import('../src/lib/firebase');
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');

  let targetDoc: any = null;

  if (searchId) {
    const docSnap = await restaurantsRef.doc(searchId).get();
    if (docSnap.exists) {
      targetDoc = docSnap;
    }
  } else if (searchName) {
    const snap = await restaurantsRef.where('name', '==', searchName).get();
    if (!snap.empty) {
      targetDoc = snap.docs[0];
    } else {
      // 부분 일치 검색
      const allSnap = await restaurantsRef.get();
      targetDoc = allSnap.docs.find(d => (d.data().name as string).includes(searchName));
    }
  }

  if (!targetDoc) {
    console.error(`❌ 지정한 가맹점을 DB에서 찾을 수 없습니다. (name=${searchName}, id=${searchId})`);
    process.exit(1);
  }

  const docId = targetDoc.id;
  const storeData = targetDoc.data();
  const storeName = storeData.name;
  let placeId = storeData.naverPlaceId;

  console.log(`\n==================================================`);
  console.log(`🎯 [단일 매장 스크래핑 시작] ${storeName} (Doc ID: ${docId})`);
  console.log(`==================================================`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  // 1. placeId가 없는 경우 네이버 지도 검색으로 placeId 자동 추출
  if (!placeId) {
    console.log(`🔍 naverPlaceId 없음 -> 네이버 지도로 placeId 자동 검색 중...`);
    const searchUrl = `https://map.naver.com/p/search/${encodeURIComponent(storeName)}`;
    await page.goto(searchUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const frame = page.frames().find(f => f.url().includes('place/'));
    if (frame) {
      const match = frame.url().match(/place\/(\d+)/);
      if (match) {
        placeId = match[1];
        console.log(`  ✅ naverPlaceId 발견: ${placeId}`);
      }
    }
  }

  if (!placeId) {
    console.error('❌ 네이버 Place ID를 찾지 못했습니다.');
    await browser.close();
    process.exit(1);
  }

  // 2. 영업시간 파싱 (펼쳐보기 클릭)
  console.log(`🕒 영업시간 및 상세 정보 파싱 중...`);
  await page.goto(`https://pcmap.place.naver.com/restaurant/${placeId}/home`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const expandBtns = await page.$$('a[role="button"], button');
  for (const btn of expandBtns) {
    const text = await btn.innerText().catch(() => '');
    if (text.includes('펼쳐보기') || text.includes('영업')) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1000);
      break;
    }
  }

  const bizHoursLines = await page.evaluate(() => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    const apolloLines: string[] = [];

    // 1. Apollo State 우선 탐색
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

    // 2. DOM 텍스트 파싱 (24시간 영업, 매일, 요일별, 연중무휴 포함)
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

  const businessHoursStr = bizHoursLines.length > 0 ? bizHoursLines.join('\n') : null;

  // 3. 메뉴 및 대표/인기 태그 파싱 ([매장] 탭 최우선)
  console.log(`🍱 메뉴 정보 ([매장] 탭 최우선, 상위 10개) 파싱 중...`);
  const mobileMenuPage = await context.newPage();
  await mobileMenuPage.goto(`https://m.place.naver.com/restaurant/${placeId}/booking?entry=ple`, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  await mobileMenuPage.waitForTimeout(2000);

  // [매장] 탭 클릭
  const btns = await mobileMenuPage.$$('button, a, [role="button"], [role="tab"]');
  for (const btn of btns) {
    const txt = await btn.innerText().catch(() => '');
    if (txt.trim() === '매장') {
      await btn.click().catch(() => {});
      await mobileMenuPage.waitForTimeout(1500);
      break;
    }
  }

  let menus: ParsedMenu[] = await mobileMenuPage.evaluate(() => {
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

    for (const k of Object.keys(apollo)) {
      const item = apollo[k];
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

        if (name && !name.includes('주문') && !name.includes('품절') && !results.some(r => r.name === name)) {
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

  if (menus.length === 0) {
    await mobileMenuPage.goto(`https://m.place.naver.com/restaurant/${placeId}/menu/list`, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
    await mobileMenuPage.waitForTimeout(2000);

    menus = await mobileMenuPage.evaluate(() => {
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

      for (const k of Object.keys(apollo)) {
        const item = apollo[k];
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

          if (name && !name.includes('주문') && !name.includes('품절') && !results.some(r => r.name === name)) {
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
  }

  const top10Menus = menus.slice(0, 10);

  // 4. Firestore DB 개별 업데이트
  const updateObj: Record<string, any> = {
    naverPlaceId: placeId,
    naverPlaceUrl: `https://map.naver.com/p/entry/place/${placeId}`,
    menus: top10Menus,
    imageUrl: null,
    isNaverEnriched: true,
    naverEnrichedAt: new Date().toISOString()
  };

  if (businessHoursStr) {
    updateObj.businessHours = businessHoursStr;
  }

  await targetDoc.ref.update(updateObj);

  await browser.close();

  console.log(`\n🎉 [수집 완수 리포트] ${storeName}`);
  console.log(`  - Naver Place ID: ${placeId}`);
  console.log(`  - Naver Place URL: https://map.naver.com/p/entry/place/${placeId}`);
  console.log(`  - 영업시간: ${businessHoursStr ? '🟢 수집 완료' : '⚪ 없음'}`);
  console.log(`  - 메뉴: 상위 ${top10Menus.length}개 수집 완료`);
  top10Menus.forEach((m, idx) => {
    const tagStr = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
    console.log(`     ${idx + 1}. ${m.name}${tagStr} - ${m.price ?? '가격미정'}`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error('[오류 발생]', err);
  process.exit(1);
});
