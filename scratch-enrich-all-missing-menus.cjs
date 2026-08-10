const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

async function parseApolloMenus(placeId) {
  try {
    const url = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) return [];
    const html = await res.text();

    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.+?\});\s*window\.__/s) ||
                       html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.+?\});/s);

    if (!apolloMatch) return [];

    const apollo = JSON.parse(apolloMatch[1]);
    const menuKeys = Object.keys(apollo).filter(k => k.startsWith('Menu:'));

    return menuKeys.map(k => {
      const item = apollo[k];
      return {
        name: item.name ?? '',
        price: item.price ? `${Number(item.price).toLocaleString()}원` : '',
        description: item.description ?? null,
        tags: item.isRecommended ? ['대표'] : [],
        isRepresentative: Boolean(item.isRecommended),
        isPopular: Boolean(item.isPopular),
      };
    }).filter(m => m.name);
  } catch (err) {
    return [];
  }
}

async function main() {
  const { db } = await import('./src/lib/firebase.ts');

  const companyCode = 'ssg';
  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  console.log(`Total restaurants: ${snap.size}`);

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

  console.log(`Found ${candidates.length} stores missing menus that have naverPlaceId`);

  let successCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const menus = await parseApolloMenus(c.placeId);
    if (menus.length > 0) {
      await c.ref.update({
        menus,
        isNaverEnriched: true,
        naverEnrichedAt: new Date().toISOString(),
      });
      successCount++;
      console.log(`[${i + 1}/${candidates.length}] 🟢 ${c.name} -> ${menus.length}개 메뉴 추가됨`);
    } else {
      console.log(`[${i + 1}/${candidates.length}] ⚪ ${c.name} -> 메뉴 0개 (네이버 상 미등록)`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n🎉 Completed! Successfully added menus to ${successCount} stores.`);
}

main().catch(err => console.error(err));
