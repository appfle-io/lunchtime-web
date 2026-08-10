const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

function parseApolloStateFromHtml(html) {
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
    } catch (err) {
      return null;
    }
  }
  return null;
}

async function fetchPlaceMenus(placeId) {
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

      const menuKeys = Object.keys(apollo).filter(k => k.startsWith('Menu:'));
      if (menuKeys.length > 0) {
        return menuKeys.map(k => {
          const item = apollo[k];
          return {
            name: item.name ?? '',
            price: item.price ? `${Number(item.price).toLocaleString()}원` : '',
            description: item.description ?? null,
            tags: item.recommend ? ['대표'] : [],
            isRepresentative: Boolean(item.recommend),
            isPopular: Boolean(item.isPopular),
          };
        }).filter(m => m.name);
      }
    } catch (err) {}
  }
  return [];
}

async function main() {
  const { db } = await import('./src/lib/firebase.ts');

  const companyCode = 'ssg';
  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();

  const candidates = [];
  snap.forEach(doc => {
    const data = doc.data();
    const hasNoMenus = !Array.isArray(data.menus) || data.menus.length === 0;
    const placeId = data.naverPlaceId || (data.naverPlaceUrl ? data.naverPlaceUrl.split('/').pop() : null);

    if (hasNoMenus && placeId) {
      candidates.push({
        ref: doc.ref,
        id: doc.id,
        name: data.name,
        placeId,
      });
    }
  });

  console.log(`Starting menu enrichment for ${candidates.length} stores missing menus...`);

  let successCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const menus = await fetchPlaceMenus(c.placeId);
    if (menus.length > 0) {
      await c.ref.update({
        menus,
        isNaverEnriched: true,
        naverEnrichedAt: new Date().toISOString(),
      });
      successCount++;
      console.log(`[${i + 1}/${candidates.length}] 🟢 ${c.name} (PlaceID: ${c.placeId}) -> ${menus.length}개 메뉴 수집 완료`);
    } else {
      console.log(`[${i + 1}/${candidates.length}] ⚪ ${c.name} (PlaceID: ${c.placeId}) -> 메뉴 없음`);
    }
    await new Promise(r => setTimeout(r, 120));
  }

  console.log(`\n🎉 Total completed! ${successCount} stores updated with menus.`);
}

main().catch(err => console.error(err));
