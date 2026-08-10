const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

function extractApolloState(html) {
  const startIdx = html.indexOf('window.__APOLLO_STATE__ = ');
  if (startIdx === -1) return null;
  const jsonStart = html.indexOf('{', startIdx);
  if (jsonStart === -1) return null;

  const scriptEnd = html.indexOf('</script>', jsonStart);
  let jsonString = html.slice(jsonStart, scriptEnd !== -1 ? scriptEnd : html.length);
  const lastSemi = jsonString.lastIndexOf(';');
  if (lastSemi !== -1) {
    jsonString = jsonString.slice(0, lastSemi);
  }
  return JSON.parse(jsonString.trim());
}

async function main() {
  const url = `https://m.place.naver.com/restaurant/38522360/menu/list`;
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  const html = await res.text();

  const apollo = extractApolloState(html);
  console.log('Apollo parsed ok?', Boolean(apollo));
  if (apollo) {
    const keys = Object.keys(apollo);
    console.log('Total keys:', keys.length);
    const menuKeys = keys.filter(k => k.toLowerCase().includes('menu'));
    console.log('Menu keys count:', menuKeys.length);
    menuKeys.forEach(k => console.log(k, apollo[k]));
  }
}

main().catch(err => console.error(err));
