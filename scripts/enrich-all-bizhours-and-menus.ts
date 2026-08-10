import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const CHECKPOINT_FILE = path.resolve(process.cwd(), '.enrich-bizhours-menus-checkpoint.json');

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

async function parseStoreFullData(page: any, placeId: string) {
  // 1. 영업시간 파싱 (모바일 home 탭)
  let businessHoursStr: string | null = null;
  try {
    await page.goto(`https://m.place.naver.com/restaurant/${placeId}/home`, { waitUntil: 'load', timeout: 12000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('a, button, div, span'));
      for (const b of btns) {
        const txt = b.textContent || '';
        if (txt.includes('영업시간') || txt.includes('영업 종료') || txt.includes('영업 중') || txt.includes('24시간 영업') || txt.includes('영업 시작')) {
          (b as HTMLElement).click();
        }
      }
    });

    await page.waitForTimeout(1000);

    const parsedLines = await page.evaluate(() => {
      const lines = (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      let isInsideBizSection = false;
      const bizSectionLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === '영업시간') {
          isInsideBizSection = true;
          continue;
        }
        if (isInsideBizSection) {
          if (line === '접기' || line.includes('영업시간 수정 제안') || line === '전화번호' || line === 'TV방송정보' || line === '편의') {
            break;
          }
          bizSectionLines.push(line);
        }
      }

      const results: string[] = [];
      let idx = 0;
      while (idx < bizSectionLines.length) {
        const cur = bizSectionLines[idx];
        const next = bizSectionLines[idx + 1] || '';

        if (cur.startsWith('매일') || ['월', '화', '수', '목', '금', '토', '일'].some(d => cur.startsWith(d))) {
          if (next && (next.includes(':') || next.includes('-') || next.includes('영업') || next.includes('정기휴무') || next.includes('휴무'))) {
            results.push(`${cur} ${next}`);
            idx += 2;
            continue;
          } else {
            results.push(cur);
          }
        } else if (cur.includes('브레이크') || cur.includes('마감') || cur.includes('라스트') || cur.includes('24시간') || cur.includes('연중무휴') || cur.startsWith('-')) {
          if (!results.includes(cur)) results.push(cur);
        }
        idx++;
      }
      return results;
    });

    if (parsedLines.length > 0) {
      businessHoursStr = parsedLines.join('\n');
    }
  } catch (_) {}

  // 2. 메뉴 파싱 (스마트주문 [매장] 탭 최우선)
  let menus: ParsedMenu[] = [];
  try {
    await page.goto(`https://m.place.naver.com/restaurant/${placeId}/booking?entry=ple`, { waitUntil: 'load', timeout: 12000 });
    await page.waitForTimeout(1200);

    const btns = await page.$$('button, a, [role="button"], [role="tab"]');
    for (const btn of btns) {
      const txt = await btn.innerText().catch(() => '');
      if (txt.trim() === '매장') {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1200);
        break;
      }
    }

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

  if (menus.length === 0) {
    try {
      await page.goto(`https://m.place.naver.com/restaurant/${placeId}/menu/list`, { waitUntil: 'load', timeout: 12000 });
      await page.waitForTimeout(1200);

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
  }

  return {
    businessHours: businessHoursStr,
    menus: menus.slice(0, 10),
  };
}

async function main() {
  const { db } = await import('../src/lib/firebase');
  const companyCode = 'ssg';
  const PARALLEL_WORKERS = 5;

  console.log(`\n==================================================`);
  console.log(`🚀 [영업시간+메뉴 전체 수집 시작] company=${companyCode} 병렬워커=${PARALLEL_WORKERS}`);
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
  let bizHoursSuccess = 0;
  let menuSuccess = 0;

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

      let res = { businessHours: null as string | null, menus: [] as ParsedMenu[] };

      if (placeId) {
        res = await parseStoreFullData(page, placeId);
      }

      const updateData: Record<string, any> = {
        menus: res.menus,
        imageUrl: null,
        isNaverEnriched: true,
        naverEnrichedAt: new Date().toISOString()
      };

      if (res.businessHours) {
        updateData.businessHours = res.businessHours;
        bizHoursSuccess++;
      }
      if (res.menus.length > 0) {
        menuSuccess++;
      }

      await doc.ref.update(updateData);

      checkpoint.add(doc.id);
      totalProcessed++;

      const bizIcon = res.businessHours ? '⏰영업시간있음' : '⚪영업시간없음';
      const menuIcon = res.menus.length > 0 ? `${res.menus.length}개메뉴` : '메뉴없음';
      console.log(`  [워커${workerId}] (${totalProcessed}/${docs.length}) 🟢 ${storeName} -> ${bizIcon} | ${menuIcon}`);

      if (totalProcessed % 10 === 0) {
        saveCheckpoint(checkpoint);
      }

      await page.waitForTimeout(500 + Math.random() * 500);
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
  console.log('🎉 [전체 1,043개 가맹점 영업시간+메뉴 통합 수집 완료 리포트]');
  console.log('==================================================');
  console.log(`Total 매장 수: ${docs.length}개`);
  console.log(`영업시간 수집 성공 매장 수: ${bizHoursSuccess}개`);
  console.log(`메뉴 수집 성공 매장 수: ${menuSuccess}개`);
  console.log(`체크포인트 완료 처리 완료!`);
}

main().catch(err => {
  console.error('[실패]', err);
  process.exit(1);
});
