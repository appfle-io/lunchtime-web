import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

/**
 * 네이버 플레이스 HTML 소스에서 __APOLLO_STATE__ JSON을 중첩 괄호 깊이(Depth) 분석으로 정확히 추출.
 */
function parseApolloStateFromHtml(html: string): Record<string, any> | null {
  const idx = html.indexOf('window.__APOLLO_STATE__');
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
  }

  if (end !== -1) {
    try {
      return JSON.parse(html.slice(start, end));
    } catch (_) {
      return null;
    }
  }
  return null;
}

interface ParsedMenu {
  name: string;
  price: string;
  description: string | null;
  tags: string[];
  isRepresentative: boolean;
  isPopular: boolean;
}

/**
 * Apollo State에서 `Menu:`, `PlaceDetail_BaeminMenu:` 등 모든 타입의 메뉴 객체를 통합 수집.
 */
function extractMenusFromApollo(apollo: Record<string, any>): ParsedMenu[] {
  if (!apollo) return [];
  const keys = Object.keys(apollo);
  const menuItems: ParsedMenu[] = [];
  const seenNames = new Set<string>();

  for (const k of keys) {
    const v = apollo[k];
    if (!v || typeof v !== 'object') continue;

    const typeName = v.__typename || '';
    const isMenuObject =
      typeName === 'Menu' ||
      typeName === 'PlaceDetail_BaeminMenu' ||
      k.startsWith('Menu:') ||
      k.includes('Menu:');

    if (isMenuObject && v.name) {
      const cleanName = String(v.name).trim();
      if (!cleanName || seenNames.has(cleanName)) continue;
      seenNames.add(cleanName);

      let priceStr = '';
      if (v.price) {
        const pNum = Number(v.price);
        if (!isNaN(pNum) && pNum > 0) {
          priceStr = `${pNum.toLocaleString()}원`;
        } else if (typeof v.price === 'string') {
          priceStr = v.price.trim();
        }
      }

      menuItems.push({
        name: cleanName,
        price: priceStr,
        description: v.description ?? null,
        tags: v.recommend ? ['대표'] : [],
        isRepresentative: Boolean(v.recommend),
        isPopular: Boolean(v.isPopular),
      });
    }
  }
  return menuItems;
}

async function fetchPlaceMenus(placeId: string): Promise<ParsedMenu[]> {
  const urls = [
    `https://m.place.naver.com/restaurant/${placeId}/menu/list`,
    `https://m.place.naver.com/restaurant/${placeId}/home`,
    `https://pcmap.place.naver.com/restaurant/${placeId}/home`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) continue;
      const html = await res.text();
      const apollo = parseApolloStateFromHtml(html);
      if (!apollo) continue;

      const menus = extractMenusFromApollo(apollo);
      if (menus.length > 0) return menus;
    } catch (_) {}
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const companyCode = args.find((a) => !a.startsWith('--')) || 'ssg';

  const { db } = await import('../src/lib/firebase');

  console.log(`[메뉴 5개 이하 가맹점 재수집 시작] company=${companyCode}`);

  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  console.log(`총 가맹점 수: ${snap.size}개`);

  const candidates: Array<{
    docRef: any;
    id: string;
    name: string;
    address: string;
    currentMenusCount: number;
    placeId: string;
  }> = [];

  snap.forEach((doc) => {
    const data = doc.data();
    const currentMenus = Array.isArray(data.menus) ? data.menus : [];
    const placeId = data.naverPlaceId || (data.naverPlaceUrl ? data.naverPlaceUrl.split('/').pop() : null);

    if (currentMenus.length <= 5 && placeId) {
      candidates.push({
        docRef: doc.ref,
        id: doc.id,
        name: data.name || '',
        address: data.address || '',
        currentMenusCount: currentMenus.length,
        placeId,
      });
    }
  });

  console.log(`대상 가맹점 (메뉴 5개 이하 & placeId 보유): ${candidates.length}곳\n`);

  let updatedCount = 0;
  let totalNewMenusAdded = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const newMenus = await fetchPlaceMenus(c.placeId);

    if (newMenus.length > c.currentMenusCount) {
      await c.docRef.update({
        menus: newMenus,
        isNaverEnriched: true,
        naverEnrichedAt: new Date().toISOString(),
      });
      updatedCount++;
      totalNewMenusAdded += newMenus.length - c.currentMenusCount;
      console.log(
        `[${i + 1}/${candidates.length}] 🟢 ${c.name} (PlaceID: ${c.placeId}) ` +
          `기존 ${c.currentMenusCount}개 → 새로 ${newMenus.length}개 메뉴 갱신 완료`
      );
    } else {
      console.log(
        `[${i + 1}/${candidates.length}] ⚪ ${c.name} (PlaceID: ${c.placeId}) ` +
          `기존 ${c.currentMenusCount}개 == 신규 ${newMenus.length}개 (변화 없음/네이버상 메뉴 없음)`
      );
    }

    await new Promise((r) => setTimeout(r, 120));
  }

  console.log('\n==================================================');
  console.log(`🎉 [재수집 완료 리포트]`);
  console.log(`- 조사 대상: ${candidates.length}곳`);
  console.log(`- 메뉴가 새로 추가/확장된 매장: ${updatedCount}곳`);
  console.log(`- 추가된 메뉴 건수: 총 ${totalNewMenusAdded}개`);
  console.log('==================================================');
}

main().catch((err) => {
  console.error('[오류 발생]', err);
  process.exit(1);
});
