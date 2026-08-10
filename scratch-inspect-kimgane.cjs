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

async function main() {
  const { db } = await import('./src/lib/firebase.ts');

  // 1. Find Kimgane Yeongdeungpo branch in DB
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();
  const kimganeDocs = snap.docs.filter(d => (d.data().name || '').includes('김가네'));

  console.log(`Found ${kimganeDocs.length} '김가네' in DB:\n`);
  for (const d of kimganeDocs) {
    console.log({
      id: d.id,
      name: d.data().name,
      address: d.data().address,
      phone: d.data().phone,
      naverPlaceUrl: d.data().naverPlaceUrl,
      naverPlaceId: d.data().naverPlaceId,
      menusCount: Array.isArray(d.data().menus) ? d.data().menus.length : 0,
      menus: d.data().menus,
    });
  }

  // 2. Fetch Naver Place for Kimgane
  for (const doc of kimganeDocs) {
    const data = doc.data();
    const placeId = data.naverPlaceId || (data.naverPlaceUrl ? data.naverPlaceUrl.split('/').pop() : null);
    if (!placeId) continue;

    console.log(`\nFetching Naver Place for ${data.name} (PlaceID: ${placeId})...`);

    const urls = [
      `https://m.place.naver.com/restaurant/${placeId}/menu/list`,
      `https://m.place.naver.com/restaurant/${placeId}/home`,
      `https://pcmap.place.naver.com/restaurant/${placeId}/home`,
    ];

    for (const url of urls) {
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
      const html = await res.text();
      console.log(`URL: ${url} (HTTP ${res.status}, Length: ${html.length})`);
      const apollo = parseApolloStateFromHtml(html);
      if (apollo) {
        const keys = Object.keys(apollo);
        const menuKeys = keys.filter(k => k.startsWith('Menu:'));
        console.log(`  APOLLO State parsed! Menu: keys count = ${menuKeys.length}`);
        if (menuKeys.length > 0) {
          const sample = menuKeys.slice(0, 5).map(k => apollo[k]);
          console.log(`  Sample menus:`, JSON.stringify(sample, null, 2));
        }
      } else {
        console.log(`  APOLLO State NOT found on this URL.`);
      }
    }
  }
}

main().catch(err => console.error(err));
