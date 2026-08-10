import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface StoreImageResult {
  storeName: string;
  placeId: string;
  imageUrl: string | null; // 식당 대표 이미지 (메인 썸네일)
  menus: Array<{
    name: string;
    price: string;
    description?: string;
    image: string | null; // 실제 메뉴 음식 사진
    isRepresentative?: boolean;
    source?: string;
  }>;
}

async function fetchStoreDetailsWithImages(page: any, placeId: string, storeName: string): Promise<StoreImageResult> {
  const mobileUrl = `https://m.place.naver.com/restaurant/${placeId}/menu/list`;

  await page.goto(mobileUrl, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(({ pid, sName }: { pid: string; sName: string }) => {
    const win = window as any;
    const apollo = win.__APOLLO_STATE__ || {};
    
    // 1. 식당 대표 이미지 (imageUrl) 추출
    let imageUrl: string | null = null;
    const baseKey = Object.keys(apollo).find(k => k.startsWith('PlaceDetailBase:') || k.startsWith('Restaurant:'));
    const base = baseKey ? apollo[baseKey] : {};

    // Header Images or Photo List
    if (Array.isArray(base.headerImages) && base.headerImages.length > 0) {
      imageUrl = base.headerImages[0].url || base.headerImages[0];
    } else if (Array.isArray(base.images) && base.images.length > 0) {
      imageUrl = base.images[0].url || base.images[0];
    }

    // Photo object keys search if imageUrl is null
    if (!imageUrl) {
      const photoKeys = Object.keys(apollo).filter(k => k.startsWith('Photo:'));
      if (photoKeys.length > 0) {
        imageUrl = apollo[photoKeys[0]].url || apollo[photoKeys[0]].imageUrl || null;
      }
    }

    // 2. 메뉴 및 메뉴 사진 추출 (네이버 맵 앱 노출 1순위: BaeminMenu / 배달포장 실물 메뉴)
    const menus: Array<{
      name: string;
      price: string;
      description?: string;
      image: string | null;
      isRepresentative?: boolean;
      source?: string;
    }> = [];

    const baeminMenuKeys = Object.keys(apollo).filter(k => k.startsWith('PlaceDetail_BaeminMenu:'));
    const regularMenuKeys = Object.keys(apollo).filter(k => k.startsWith('Menu:'));

    // BaeminMenu 가 존재하면 네이버 맵 모바일 기준(실물 음식 사진)으로 1순위 수집
    if (baeminMenuKeys.length > 0) {
      baeminMenuKeys.forEach(k => {
        const item = apollo[k];
        if (item && item.name) {
          const imgList = Array.isArray(item.images) ? item.images : [];
          const validImg = imgList.find((img: string) => img && img.trim().length > 0) || null;
          
          menus.push({
            name: item.name,
            price: item.price ?? '',
            description: item.desc ?? item.description ?? '',
            image: validImg,
            isRepresentative: item.isRepresentative ?? false,
            source: 'naver_map_baemin'
          });
        }
      });
    }

    // 일반 메뉴 추가
    regularMenuKeys.forEach(k => {
      const item = apollo[k];
      if (item && item.name) {
        // 이미 BaeminMenu로 같은 메뉴가 들어가지 않은 경우만 추가
        const exists = menus.some(m => m.name.replace(/\s+/g, '') === item.name.replace(/\s+/g, ''));
        if (!exists) {
          const imgList = Array.isArray(item.images) ? item.images : [];
          const validImg = imgList.find((img: string) => img && img.trim().length > 0) || null;

          menus.push({
            name: item.name,
            price: item.price ?? '',
            description: item.description ?? '',
            image: validImg,
            isRepresentative: item.recommend ?? false,
            source: 'naver_map_regular'
          });
        }
      }
    });

    return {
      storeName: sName,
      placeId: pid,
      imageUrl,
      menus: menus.slice(0, 10)
    };
  }, { pid: placeId, sName: storeName });

  return result;
}

async function main() {
  const targetStores = [
    { name: '송죽장', placeId: '1265614058' },
    { name: '하루국시101 영등포점', placeId: '37841977' },
    { name: '3일한우국밥', placeId: '37379272' },
    { name: '디톡시', placeId: '38431209' }
  ];

  console.log('\n🚀 [4개 테스트 샘플 매장] 대표사진 & 실물 메뉴사진 정밀 수집 테스트 시작\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  for (const store of targetStores) {
    const res = await fetchStoreDetailsWithImages(page, store.placeId, store.name);
    
    console.log(`==================================================`);
    console.log(`📌 매장명: ${res.storeName} (ID: ${res.placeId})`);
    console.log(`🖼️ 식당 대표 메인 사진 (imageUrl): ${res.imageUrl ?? '없음'}`);
    console.log(`🍱 수집된 메뉴 수: ${res.menus.length}개`);
    console.log(`--- [메뉴 샘플 상위 3개] ---`);
    res.menus.slice(0, 3).forEach((m, idx) => {
      console.log(`  ${idx + 1}. [${m.name}] - ${m.price}원`);
      console.log(`     └ 📸 메뉴 사진 URL: ${m.image ?? '(사진 없음)'}`);
      console.log(`     └ 🏷️ 출처: ${m.source}`);
    });
    console.log(`==================================================\n`);
  }

  await browser.close();
  process.exit(0);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
