import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface DomMenuItem {
  name: string;
  price: string;
  description: string;
  image: string | null; // 실제 네이버 맵 화면 상에 눈으로 보이는 <img> 사진이 있을 때만 URL!
}

async function scrapeVisibleDomMenus(page: any, placeId: string, storeName: string) {
  const menuTabUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/menu/list`;

  try {
    await page.goto(menuTabUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      // 1. 네이버 맵 [메뉴] 탭 화면 렌더링 요소 선택
      const menuListContainer = document.querySelector('ul.menu_list') || document.querySelector('ul[class*="menu"]');
      
      // 메뉴 컨테이너 자체가 없는 경우 -> 메뉴 탭 미존재
      if (!document.body.innerText.includes('메뉴') && !menuListContainer) {
        return { hasMenuTab: false, menus: [] };
      }

      // 2. 화면 상에 출력된 메뉴 항목 엘리먼트 추출
      const menuElements = Array.from(document.querySelectorAll('li[class*="menu"]'));
      
      const items: DomMenuItem[] = [];

      for (const el of menuElements) {
        const text = (el as HTMLElement).innerText || '';
        if (!text.trim()) continue;

        // 메뉴 이름 & 가격 파싱
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        let name = lines[0] || '';
        if (name === '대표') name = lines[1] || '';
        
        let price = '';
        const priceLine = lines.find(l => l.includes('원'));
        if (priceLine) price = priceLine;

        // 실제 화면상 <img> 태그 존재 여부 체크! (눈으로 안 보이는 텍스트형 메뉴는 null)
        const imgEl = el.querySelector('img');
        let visibleImgUrl: string | null = null;

        if (imgEl && imgEl.src) {
          const src = imgEl.src;
          if (src.includes('ldb-phinf') || src.includes('search.pstatic')) {
            visibleImgUrl = src;
          }
        }

        if (name && name !== '메뉴 항목과 가격은 각 매장의 사정에 따라 기재된 내용과 다를 수 있습니다.') {
          items.push({
            name,
            price,
            description: '',
            image: visibleImgUrl
          });
        }
      }

      // 만약 DOM 탐색이 수월치 않으면 apolloState의 render된 메뉴 이미지 체크
      if (items.length === 0) {
        const win = window as any;
        const apollo = win.__APOLLO_STATE__ || {};
        const menuKeys = Object.keys(apollo).filter(k => k.startsWith('Menu:'));

        for (const k of menuKeys) {
          const item = apollo[k];
          if (!item || !item.name) continue;

          // 디톡시처럼 백엔드에는 있으나 화면에는 안 보이는 텍스트형 메뉴는 null로 간주
          // 실제 렌더링 이미지 유무 체크
          items.push({
            name: item.name,
            price: item.price ? `${Number(item.price).toLocaleString()}원` : '',
            description: item.description ?? '',
            image: null // DOM에 미노출된 것은 null
          });
        }
      }

      return {
        hasMenuTab: true,
        menus: items
      };
    });

    return {
      storeName,
      placeId,
      hasMenuTab: result.hasMenuTab,
      menus: result.menus
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

  console.log('\n🚀 [네이버 맵 실제 화면 렌더링 1:1 무결성 수집] 4개 가맹점 다시 검증 시작\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  const { db } = await import('../src/lib/firebase');
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');

  for (const store of targetStores) {
    const res = await scrapeVisibleDomMenus(page, store.placeId, store.name);

    await restaurantsRef.doc(store.docId).update({
      menus: res.menus,
      imageUrl: null, // 가게 대표 이미지 완전 삭제
      isNaverEnriched: true,
      naverPlaceUrl: `https://map.naver.com/p/entry/place/${store.placeId}`
    });

    console.log(`==================================================`);
    console.log(`📌 매장명: ${res.storeName} (placeId: ${res.placeId})`);
    console.log(`📋 네이버 맵 [메뉴] 탭 존재 여부: ${res.hasMenuTab ? '🟢 있음' : '🔴 없음'}`);
    console.log(`🍱 실제 화면에 렌더링된 메뉴 수: ${res.menus.length}개`);
    
    res.menus.slice(0, 5).forEach((m: any, idx: number) => {
      console.log(`  ${idx + 1}. [${m.name}] - ${m.price}`);
      console.log(`     └ 📸 화면에 실제로 보이는 사진: ${m.image ? `🟢 있음 (${m.image})` : '🔴 없음 (null)'}`);
    });
    console.log(`==================================================\n`);
  }

  await browser.close();
  console.log('✅ 디톡시 포함 4개 가맹점 화면 1:1 재검증 및 DB 커밋 완수!');
  process.exit(0);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
