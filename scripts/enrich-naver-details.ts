import dotenv from 'dotenv';
import path from 'node:path';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function extractRoadName(addr: string): string | null {
  if (!addr) return null;
  const match = addr.match(/([가-힣]+로|[가-힣]+길)/);
  return match ? match[1] : null;
}

function extractBuildingNum(addr: string): string | null {
  if (!addr) return null;
  const match = addr.match(/([가-힣]+로|[가-힣]+길)\s*([0-9]+)/);
  return match ? match[2] : null;
}

/** 3중 엄격 교차 검증: 주소 건물번호 일치 여부 */
function isStrictAddressMatched(dbAddr: string, targetAddr: string): boolean {
  if (!dbAddr || !targetAddr) return false;
  const dbRoad = extractRoadName(dbAddr);
  const targetRoad = extractRoadName(targetAddr);
  const dbNum = extractBuildingNum(dbAddr);
  const targetNum = extractBuildingNum(targetAddr);

  if (!dbRoad || !targetRoad || dbRoad !== targetRoad) return false;
  if (!dbNum || !targetNum) return false;

  return dbNum === targetNum;
}

interface NaverEnrichedMenuItem {
  name: string;
  price: string;
  description?: string;
  image?: string | null;
  // 2026-08-09 신규 (scripts/test-4-stores-images.ts에서 검증한 로직을 실제 수집 파이프라인에 연결):
  // 배민 실물 음식사진 메뉴("naver_map_baemin")로 잡혔는지, 네이버가 자체적으로 "대표" 표시한
  // 메뉴인지("recommend") 여부. 화면에서 "대표" 배지 표시용.
  isRepresentative?: boolean;
  source?: string;
}

interface NaverEnrichedData {
  phone: string | null;
  businessHours: any | null;
  facilities: string[];
  paymentMethods: string[];
  aiBriefing: string | null;
  menus: NaverEnrichedMenuItem[];
  // 2026-08-09 신규: 식당 대표 이미지(메인 썸네일). 메뉴 사진(menus[].image)과는 별개 필드로 구분해서 저장.
  mainImage: string | null;
  recentReviews: Array<{ body: string; created?: string; nickname?: string }>;
  naverPlaceId: string;
  naverPlaceUrl: string;
  naverMatchedName: string;
  naverMatchedAddress: string;
}

async function fetchNaverPlaceDetails(page: any, placeId: string): Promise<NaverEnrichedData | null> {
  try {
    const homeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
    // 2026-08-09: scripts/update-naver-urls.ts로 기존 문서를 이미 이 최신 공식 규격으로 일괄
    // 마이그레이션해둔 상태라, 앞으로 새로 수집하는 것도 같은 형식으로 통일한다.
    const placeDirectUrl = `https://map.naver.com/p/entry/place/${placeId}`;

    await page.goto(homeUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1500);

    const homeData = await page.evaluate(() => {
      const win = window as any;
      const apollo = win.__APOLLO_STATE__ || {};
      const baseKey = Object.keys(apollo).find(k => k.startsWith('PlaceDetailBase:'));
      const base = baseKey ? apollo[baseKey] : {};

      const menuKeys = Object.keys(apollo).filter(k => k.startsWith('Menu:'));
      const menus = menuKeys.map(k => {
        const item = apollo[k];
        return {
          name: item.name ?? '',
          price: item.price ?? '',
          description: item.description ?? '',
          image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null
        };
      }).filter(m => m.name);

      let bizHours = base.openingHours || base.bizhourInfo || null;
      let aiBriefing = null;
      if (Array.isArray(base.microReviews) && base.microReviews.length > 0) {
        aiBriefing = base.microReviews[0];
      } else if (typeof base.smartSummary === 'string') {
        aiBriefing = base.smartSummary;
      }

      return {
        phone: base.phone || base.virtualPhone || null,
        facilities: Array.isArray(base.conveniences) ? base.conveniences : (Array.isArray(base.facilityInfo) ? base.facilityInfo : []),
        paymentMethods: Array.isArray(base.paymentInfo) ? base.paymentInfo : [],
        aiBriefing,
        businessHours: bizHours,
        menus: menus.slice(0, 10),
        name: base.name || null,
        address: base.roadAddress || base.address || null
      };
    });

    // 2026-08-09 신규: 대표이미지(식당 메인 사진)와 실제 음식 메뉴사진을 구별해서 수집한다
    // (scripts/test-4-stores-images.ts에서 4개 매장으로 미리 검증한 로직). 홈 페이지(pcmap, /home)
    // Apollo 캐시엔 메뉴 사진이 부실한 경우가 많아서, 모바일 메뉴탭을 한 번 더 방문해서
    // headerImages/Photo(대표이미지)와 BaeminMenu(실물 음식사진, 최우선)+Menu를 합쳐 재수집하고,
    // 성공하면 홈 페이지에서 얻은 menus를 이걸로 덮어쓴다. 실패해도(레이아웃이 없거나 타임아웃)
    // 홈 페이지 menus로 조용히 폴백한다 - 부가정보라 전체 수집을 막지 않는다.
    let mainImage: string | null = null;
    let enrichedMenus: NaverEnrichedMenuItem[] = homeData.menus;

    try {
      await page.goto(`https://m.place.naver.com/restaurant/${placeId}/menu/list`, {
        waitUntil: 'load',
        timeout: 15000,
      });
      await page.waitForTimeout(1500);

      const imageData = await page.evaluate(() => {
        const win = window as any;
        const apollo = win.__APOLLO_STATE__ || {};

        let imageUrl: string | null = null;
        const baseKey = Object.keys(apollo).find(
          (k) => k.startsWith('PlaceDetailBase:') || k.startsWith('Restaurant:')
        );
        const base = baseKey ? apollo[baseKey] : {};

        if (Array.isArray(base.headerImages) && base.headerImages.length > 0) {
          imageUrl = base.headerImages[0].url || base.headerImages[0];
        } else if (Array.isArray(base.images) && base.images.length > 0) {
          imageUrl = base.images[0].url || base.images[0];
        }
        if (!imageUrl) {
          const photoKeys = Object.keys(apollo).filter((k) => k.startsWith('Photo:'));
          if (photoKeys.length > 0) {
            imageUrl = apollo[photoKeys[0]].url || apollo[photoKeys[0]].imageUrl || null;
          }
        }

        const menus: Array<{
          name: string;
          price: string;
          description?: string;
          image: string | null;
          isRepresentative?: boolean;
          source?: string;
        }> = [];

        // 배민 실물 음식사진("PlaceDetail_BaeminMenu")이 있으면 최우선으로 수집.
        const baeminMenuKeys = Object.keys(apollo).filter((k) => k.startsWith('PlaceDetail_BaeminMenu:'));
        const regularMenuKeys = Object.keys(apollo).filter((k) => k.startsWith('Menu:'));

        baeminMenuKeys.forEach((k) => {
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
              source: 'naver_map_baemin',
            });
          }
        });

        // 배민 실물사진으로 이미 잡힌 메뉴가 아니면 일반 메뉴로 보강.
        regularMenuKeys.forEach((k) => {
          const item = apollo[k];
          if (item && item.name) {
            const exists = menus.some((m) => m.name.replace(/\s+/g, '') === item.name.replace(/\s+/g, ''));
            if (!exists) {
              const imgList = Array.isArray(item.images) ? item.images : [];
              const validImg = imgList.find((img: string) => img && img.trim().length > 0) || null;
              menus.push({
                name: item.name,
                price: item.price ?? '',
                description: item.description ?? '',
                image: validImg,
                isRepresentative: item.recommend ?? false,
                source: 'naver_map_regular',
              });
            }
          }
        });

        return { imageUrl, menus: menus.slice(0, 10) };
      });

      mainImage = imageData.imageUrl;
      if (imageData.menus.length > 0) {
        enrichedMenus = imageData.menus;
      }
    } catch (_) {
      // 모바일 메뉴탭 수집이 실패해도(레이아웃 변경/타임아웃 등) 홈 페이지 menus로 계속 진행.
    }

    let recentReviews: Array<{ body: string; created?: string; nickname?: string }> = [];
    try {
      await page.goto(`https://pcmap.place.naver.com/restaurant/${placeId}/review/visitor`, { waitUntil: 'load', timeout: 10000 });
      await page.waitForTimeout(1500);

      recentReviews = await page.evaluate(() => {
        const win = window as any;
        const apollo = win.__APOLLO_STATE__ || {};
        const reviewKeys = Object.keys(apollo).filter(k => k.includes('VisitorReview') && apollo[k]?.body);
        return reviewKeys.slice(0, 5).map(k => {
          const r = apollo[k];
          return {
            body: r.body ?? '',
            created: r.created ?? '',
            nickname: r.author?.nickname ?? ''
          };
        }).filter(r => r.body);
      });
    } catch (_) {}

    return {
      phone: homeData.phone,
      businessHours: homeData.businessHours,
      facilities: homeData.facilities,
      paymentMethods: homeData.paymentMethods,
      aiBriefing: homeData.aiBriefing,
      menus: enrichedMenus,
      mainImage,
      recentReviews,
      naverPlaceId: placeId,
      naverPlaceUrl: placeDirectUrl,
      naverMatchedName: homeData.name ?? '',
      naverMatchedAddress: homeData.address ?? ''
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

  const { db } = await import('../src/lib/firebase');
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();

  console.log(`\n🚀 [네이버 맵 링크 포함 정밀 수집 - 대표이미지/메뉴사진 구분 수집] 총 ${snap.size}개 매장 중 수집 시작 (dry-run: ${isDryRun})\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR'
  });
  const page = await context.newPage();

  let targetDocs = snap.docs;
  if (limit !== Infinity) {
    targetDocs = targetDocs.slice(0, limit);
  }

  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let doneCount = 0;
  const total = targetDocs.length;

  for (const doc of targetDocs) {
    doneCount++;
    const data = doc.data();
    const docId = doc.id;
    const name = data.name as string;
    const dbAddr = (data.address as string) ?? '';
    let placeId = data.naverPlaceId as string | undefined;

    if (placeId && data.naverMatchedAddress) {
      if (!isStrictAddressMatched(dbAddr, data.naverMatchedAddress)) {
        placeId = undefined;
      }
    }

    if (!placeId) {
      try {
        const searchPage = await context.newPage();
        let foundPlaceId: string | null = null;
        let foundAddress: string | null = null;

        searchPage.on('response', async res => {
          if (foundPlaceId) return;
          const u = res.url();
          if (u.includes('/api/search/allSearch') || u.includes('/api/search/place')) {
            try {
              const json = await res.json();
              const items = json?.result?.place?.list ?? json?.result?.place?.items ?? [];
              for (const item of items) {
                const itemAddr = String(item.roadAddress ?? item.address ?? '');
                if (isStrictAddressMatched(dbAddr, itemAddr)) {
                  foundPlaceId = String(item.id ?? item.placeId ?? '');
                  foundAddress = itemAddr;
                  break;
                }
              }
            } catch (_) {}
          }
        });

        await searchPage.goto(`https://map.naver.com/p/search/${encodeURIComponent(name)}`, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
        await searchPage.waitForTimeout(3500);
        await searchPage.close();

        if (foundPlaceId) {
          placeId = foundPlaceId;
        }
      } catch (_) {}
    }

    if (!placeId) {
      skippedCount++;
      console.log(`  [${doneCount}/${total}] ⚠️ (안전 스킵: 100% 일치 장소 없음) ${name}`);
      continue;
    }

    const details = await fetchNaverPlaceDetails(page, placeId);

    if (details && (details.menus.length > 0 || details.phone || details.facilities.length > 0 || details.recentReviews.length > 0 || details.mainImage)) {
      successCount++;
      console.log(`  [${doneCount}/${total}] 🟢 (100% 수집 성공!) ${name} [URL: ${details.naverPlaceUrl}]${details.mainImage ? ' [대표이미지 O]' : ''}`);

      if (!isDryRun) {
        await restaurantsRef.doc(docId).update({
          phone: details.phone || data.phone || null,
          businessHours: details.businessHours || null,
          facilities: details.facilities,
          paymentMethods: details.paymentMethods,
          aiBriefing: details.aiBriefing || null,
          menus: details.menus,
          mainImage: details.mainImage || null,
          recentReviews: details.recentReviews,
          naverPlaceId: details.naverPlaceId,
          naverPlaceUrl: details.naverPlaceUrl,
          naverMatchedName: details.naverMatchedName,
          naverMatchedAddress: details.naverMatchedAddress,
          naverEnrichedAt: new Date().toISOString(),
          isNaverEnriched: true,
        });
      }
    } else {
      failedCount++;
      console.log(`  [${doneCount}/${total}] 🔴 (상세 정보 누락) ${name}`);
    }

    await page.waitForTimeout(200);
  }

  await page.close();
  await context.close();
  await browser.close();

  console.log(`\n=== 🎯 수집 결과 요약 (dry-run: ${isDryRun}) ===`);
  console.log(`총 시도: ${total}개`);
  console.log(`🟢 100% 정밀 수집 성공: ${successCount}개`);
  console.log(`⚠️ 오매핑 방지 안전 스킵: ${skippedCount}개`);
  console.log(`🔴 상세 정보 부족: ${failedCount}개`);

  process.exit(0);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
