import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface ExactMenuTabItem {
  name: string;
  price: string;
  description: string;
  image: string | null;
}

interface ExactStoreMenuResult {
  storeName: string;
  placeId: string;
  hasMenuTab: boolean;
  menus: ExactMenuTabItem[];
}

async function scrapeExactNaverMenuTab(page: any, placeId: string, storeName: string): Promise<ExactStoreMenuResult> {
  const menuTabUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/menu/list`;

  try {
    await page.goto(menuTabUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(2000);

    const scraped = await page.evaluate(() => {
      const win = window as any;
      const apollo = win.__APOLLO_STATE__ || {};

      // 1. 네이버 맵 [메뉴] 탭의 정식 Menu 객체만 탐색 (PlaceDetail_BaeminMenu 배달 연동 제외)
      const menuKeys = Object.keys(apollo).filter(k => k.startsWith('Menu:'));
      
      if (menuKeys.length === 0) {
        return {
          hasMenuTab: false,
          menus: []
        };
      }

      const items: ExactMenuTabItem[] = [];

      for (const k of menuKeys) {
        const item = apollo[k];
        if (!item || !item.name) continue;

        // 사진: 네이버 메뉴 탭 공식 등록 이미지
        let imgUrl: string | null = null;
        if (Array.isArray(item.images) && item.images.length > 0) {
          const firstImg = item.images[0];
          if (typeof firstImg === 'string' && firstImg.trim().length > 0 && !firstImg.includes('image_library')) {
            imgUrl = firstImg;
          }
        }

        items.push({
          name: item.name,
          price: item.price ? `${Number(item.price).toLocaleString()}원` : '',
          description: item.description ?? '',
          image: imgUrl
        });
      }

      return {
        hasMenuTab: true,
        menus: items
      };
    });

    return {
      storeName,
      placeId,
      hasMenuTab: scraped.hasMenuTab,
      menus: scraped.menus
    };
  } catch (err) {
    return {
      storeName,
      placeId,
      hasMenuTab: false,
      menus: []
    };
  }
}

async function main() {
  const targetStores = [
    { name: '송죽장', placeId: '1265614058', docId: '7a74b08a70688ca5' },
    { name: '하루국시101 영등포점', placeId: '37841977', docId: '0242362e837758d7' },
    { name: '3일한우국밥', placeId: '37379272', docId: 'f0ab8efc80ce0fdf' },
    { name: '디톡시', placeId: '38431209', docId: 'b6a10321984edf68' }
  ];

  console.log('\n🚀 [네이버 맵 메뉴 탭 1:1 무결성 수집] 4개 테스트 가맹점 다시 수집 시작\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  const { db } = await import('../src/lib/firebase');
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');

  for (const store of targetStores) {
    const res = await scrapeExactNaverMenuTab(page, store.placeId, store.name);

    // DB 업데이트: 가게 대표 이미지(imageUrl) 필드 완전 삭제 및 네이버 맵 [메뉴] 탭 동일 메뉴 반영
    const updatePayload: any = {
      menus: res.menus,
      isNaverEnriched: true,
      naverPlaceUrl: `https://map.naver.com/p/entry/place/${store.placeId}`,
      imageUrl: null // 대표 이미지 삭제 요청 적용
    };

    await restaurantsRef.doc(store.docId).update(updatePayload);

    console.log(`==================================================`);
    console.log(`📌 매장명: ${res.storeName} (placeId: ${res.placeId})`);
    console.log(`📋 네이버 맵 [메뉴] 탭 존재 여부: ${res.hasMenuTab ? '🟢 있음' : '🔴 없음 (메뉴 미출력)'}`);
    console.log(`🍱 수집된 [메뉴] 탭 메뉴 수: ${res.menus.length}개`);
    
    if (res.menus.length > 0) {
      console.log(`--- [메뉴 탭 렌더링 메뉴 샘플] ---`);
      res.menus.slice(0, 5).forEach((m, idx) => {
        console.log(`  ${idx + 1}. [${m.name}] - ${m.price}`);
        console.log(`     └ 📸 메뉴 탭 사진 URL: ${m.image ?? '(사진 없음)'}`);
      });
    } else {
      console.log(`  ⚠️ 메뉴 탭이 없어 메뉴 정보가 등록되지 않습니다.`);
    }
    console.log(`==================================================\n`);
  }

  await browser.close();
  console.log('✅ 4개 가맹점 재수집 및 DB 커밋 완전 완료!');
  process.exit(0);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
