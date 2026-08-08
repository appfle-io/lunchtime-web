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
    await page.waitForTimeout(1200);

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
      await page.waitForTimeout(1200);

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
  const { db } = await import('../src/lib/firebase');
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();
  const docs = snap.docs;
  const PARALLEL = 5;

  console.log(`\n🚀 [네이버 맵 5병렬 초고속 정밀 수집] 총 ${docs.length}개 매장 시작\n`);

  const browser = await chromium.launch({ headless: true });
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');
  
  let successCount = 0;
  let skippedCount = 0;
  let doneCount = 0;
  const total = docs.length;
  const startTime = Date.now();

  const chunkSize = Math.ceil(total / PARALLEL);
  const chunks = Array.from({ length: PARALLEL }, (_, i) => docs.slice(i * chunkSize, (i + 1) * chunkSize));

  async function worker(chunk: typeof docs, workerId: number) {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'ko-KR'
    });
    const page = await context.newPage();

    for (const doc of chunk) {
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
          await searchPage.waitForTimeout(3000);
          await searchPage.close();

          if (foundPlaceId) {
            placeId = foundPlaceId;
          }
        } catch (_) {}
      }

      if (!placeId) {
        skippedCount++;
        continue;
      }

      const details = await fetchNaverPlaceDetails(page, placeId);

      if (details && (details.menus.length > 0 || details.phone || details.facilities.length > 0 || details.recentReviews.length > 0)) {
        successCount++;
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
        console.log(`  [W${workerId}] [${doneCount}/${total}] 🟢 ${name} [URL: ${details.naverPlaceUrl}]`);
      }

      await page.waitForTimeout(100);
    }

    await page.close();
    await context.close();
  }

  await Promise.all(chunks.map((chunk, idx) => worker(chunk, idx + 1)));
  await browser.close();

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n=== 🎯 5병렬 초고속 수집 최종 완결 (소요시간: ${elapsedSec}초) ===`);
  console.log(`총 시도: ${total}개`);
  console.log(`🟢 100% 정밀 수집 및 DB 커밋 완료: ${successCount}개`);
  console.log(`⚠️ 오매핑 방지 안전 스킵: ${skippedCount}개`);

  process.exit(0);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
