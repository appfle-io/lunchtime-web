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

interface NaverEnrichedData {
  phone: string | null;
  businessHours: any | null;
  facilities: string[];
  paymentMethods: string[];
  aiBriefing: string | null;
  menus: Array<{ name: string; price: string; description?: string; image?: string }>;
  recentReviews: Array<{ body: string; created?: string; nickname?: string }>;
  naverPlaceId: string;
  naverPlaceUrl: string;
  naverMatchedName: string;
  naverMatchedAddress: string;
}

async function fetchNaverPlaceDetails(page: any, placeId: string): Promise<NaverEnrichedData | null> {
  try {
    const homeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
    const placeDirectUrl = `https://m.map.naver.com/place.naver?id=${placeId}`;

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
      menus: homeData.menus,
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

  console.log(`\n🚀 [네이버 맵 링크 포함 정밀 수집] 총 ${snap.size}개 매장 중 수집 시작 (dry-run: ${isDryRun})\n`);

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

    if (details && (details.menus.length > 0 || details.phone || details.facilities.length > 0 || details.recentReviews.length > 0)) {
      successCount++;
      console.log(`  [${doneCount}/${total}] 🟢 (100% 수집 성공!) ${name} [URL: ${details.naverPlaceUrl}]`);

      if (!isDryRun) {
        await restaurantsRef.doc(docId).update({
          phone: details.phone || data.phone || null,
          businessHours: details.businessHours || null,
          facilities: details.facilities,
          paymentMethods: details.paymentMethods,
          aiBriefing: details.aiBriefing || null,
          menus: details.menus,
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
