import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const CHECKPOINT_FILE = path.resolve(process.cwd(), '.enrich-official-final-checkpoint.json');

function loadCheckpoint(): Set<string> {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
      return new Set<string>(data.done ?? []);
    }
  } catch (_) {}
  return new Set<string>();
}

function saveCheckpoint(done: Set<string>) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ done: [...done], updatedAt: new Date().toISOString() }));
}

interface ParsedMenu {
  name: string;
  price: string | null;
  description?: string | null;
  tags: string[];
  isRepresentative: boolean;
  isPopular: boolean;
}

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

async function parseStoreMenus(page: any, placeId: string): Promise<ParsedMenu[]> {
  let menus: ParsedMenu[] = [];

  // 1. [매장] 탭이 있는 스마트주문 (NOrder/Booking) 접속 시도
  const bookingUrl = `https://m.place.naver.com/restaurant/${placeId}/booking?entry=ple`;
  try {
    await page.goto(bookingUrl, { waitUntil: 'load', timeout: 12000 });
    await page.waitForTimeout(1500);

    // [매장] 탭 버튼 클릭
    const btns = await page.$$('button, a, [role="button"], [role="tab"]');
    let storeClicked = false;
    for (const btn of btns) {
      const txt = await btn.innerText().catch(() => '');
      if (txt.trim() === '매장') {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1500);
        storeClicked = true;
        break;
      }
    }

    // Apollo State 파싱
    menus = await page.evaluate(() => {
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
  } catch (_) {}

  // 2. [매장] NOrder 스마트주문 파싱 결과가 없거나 부족한 경우 일반 모바일 메뉴 탭 (/menu/list) 접속
  if (menus.length === 0) {
    const mobileMenuUrl = `https://m.place.naver.com/restaurant/${placeId}/menu/list`;
    try {
      await page.goto(mobileMenuUrl, { waitUntil: 'load', timeout: 12000 });
      await page.waitForTimeout(1500);

      // Apollo State + DOM 텍스트 파싱
      menus = await page.evaluate(() => {
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

        // 2-1. Apollo State 우선 파싱
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

        // 2-2. DOM 텍스트 렌더링 보완 파싱
        if (results.length === 0) {
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
        }

        return results;
      });
    } catch (_) {}
  }

  // 상위 10개만 제한
  return menus.slice(0, 10);
}

async function main() {
  const { db } = await import('../src/lib/firebase');
  const companyCode = 'ssg';
  const PARALLEL_WORKERS = 5;

  console.log(`\n==================================================`);
  console.log(`🚀 [전체 수집 시작] company=${companyCode} 병렬워커=${PARALLEL_WORKERS}`);
  console.log(`📌 수집 규칙:`);
  console.log(`   1. 이미지는 완전히 제거 (imageUrl: null, menus[].image 없음)`);
  console.log(`   2. [매장] 탭 최우선 수집`);
  console.log(`   3. 상위 10개 메뉴 자르기`);
  console.log(`   4. [대표], [인기] 태그 수집`);
  console.log(`==================================================\n`);

  const checkpoint = loadCheckpoint();
  if (checkpoint.size > 0) {
    console.log(`ℹ️ [체크포인트] 기존 처리 완료된 ${checkpoint.size}개 매장 연속 진행`);
  }

  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  if (snap.empty) {
    console.log('가맹점 문서가 없습니다.');
    return;
  }

  const docs = snap.docs;
  const pendingDocs = docs.filter(d => !checkpoint.has(d.id));
  console.log(`📊 전체 ${docs.length}개 매장 중 미처리 ${pendingDocs.length}개 수집 시작...\n`);

  const browser = await chromium.launch({ headless: true });
  let totalProcessed = checkpoint.size;
  let successCount = 0;
  let emptyMenuStoresCount = 0;

  async function workerTask(workerId: number, chunk: typeof pendingDocs) {
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      viewport: { width: 390, height: 844 },
      locale: 'ko-KR'
    });
    const page = await context.newPage();

    for (const doc of chunk) {
      const data = doc.data();
      const storeName = data.name as string;
      const placeId = data.naverPlaceId as string | undefined;

      let menus: ParsedMenu[] = [];

      if (placeId) {
        menus = await parseStoreMenus(page, placeId);
      }

      // Firestore 커밋 (이미지 제외, 메뉴 10개, 매장 탭 최우선)
      const updateData: Record<string, any> = {
        menus: menus,
        imageUrl: null, // 식당 대표이미지 제거
        isNaverEnriched: true,
        naverEnrichedAt: new Date().toISOString()
      };

      await doc.ref.update(updateData);

      checkpoint.add(doc.id);
      totalProcessed++;
      if (menus.length > 0) successCount++;
      else emptyMenuStoresCount++;

      const menuCountStr = menus.length > 0 ? `${menus.length}개` : '메뉴탭없음';
      console.log(`  [워커${workerId}] (${totalProcessed}/${docs.length}) 🟢 ${storeName} -> ${menuCountStr}`);

      if (totalProcessed % 10 === 0) {
        saveCheckpoint(checkpoint);
      }

      await page.waitForTimeout(600 + Math.random() * 600);
    }

    await context.close();
  }

  const chunkSize = Math.ceil(pendingDocs.length / PARALLEL_WORKERS);
  const chunks = Array.from({ length: PARALLEL_WORKERS }, (_, i) =>
    pendingDocs.slice(i * chunkSize, (i + 1) * chunkSize)
  );

  try {
    await Promise.all(chunks.map((chunk, idx) => workerTask(idx + 1, chunk)));
  } finally {
    saveCheckpoint(checkpoint);
    await browser.close();
  }

  console.log('\n==================================================');
  console.log('🎉 [전체 가맹점 수집 완수 최종 리포트]');
  console.log('==================================================');
  console.log(`Total 매장 수: ${docs.length}개`);
  console.log(`성공적으로 메뉴 수집된 매장 수: ${successCount}개`);
  console.log(`메뉴탭이 없어서 메뉴 0개 처리된 매장 수: ${emptyMenuStoresCount}개`);
  console.log(`체크포인트 완료 처리 완료!`);
}

main().catch(err => {
  console.error('[실패]', err);
  process.exit(1);
});
