// 가맹점 중복 감지 및 정리 스크립트.
//
// 사용법:
//   npm run dedupe:restaurants -- ssg --dry-run   (삭제 없이 중복 리포트만 출력)
//   npm run dedupe:restaurants -- ssg             (실제 삭제 실행)
//
// 중복 판단 기준 (2단계):
//   1. [확실한 중복] 도로명 주소 핵심부가 같고 이름 유사도 >= 0.85 → 자동 삭제
//   2. [의심 중복]   이름 유사도 >= 0.70 AND 직선거리 <= 80m    → 리포트만 출력
//
// 보존 우선순위: manual > seed > opendata
//   같은 중복 그룹 내에서 source가 더 "신뢰도 높은" 문서를 남기고 나머지를 삭제.

import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ──────────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────────

/** 두 문자열의 자카드 유사도 (0~1). 공백 무시, 글자 단위 집합 비교. */
function similarity(a: string, b: string): number {
  const sa = new Set(a.replace(/\s/g, '').split(''));
  const sb = new Set(b.replace(/\s/g, '').split(''));
  const intersection = [...sa].filter(c => sb.has(c)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : intersection / union;
}

/** 위경도 두 점 사이 직선거리 (m). */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 도로명 주소에서 "핵심부"만 추출한다.
 * "서울특별시 영등포구 선유로 76 1층 102호" → "영등포구 선유로 76"
 * 층/호/지하 등 세부 정보를 제거해서 같은 건물 다른 층 = 같은 주소로 인식.
 */
function normalizeAddress(addr: string): string {
  return addr
    .replace(/서울특별시|서울시|경기도|인천광역시/g, '')
    .replace(/[\(\)（）]/g, ' ')
    .replace(/[0-9]+층|[0-9]+호|지하[0-9]+층|B[0-9]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const SOURCE_PRIORITY: Record<string, number> = {
  manual: 3,
  seed: 2,
  opendata: 1,
};

function sourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 0;
}

interface RestaurantDoc {
  _id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
}

// ──────────────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const companyCode = args.find(a => !a.startsWith('--'));
  if (!companyCode) {
    console.error('사용법: npm run dedupe:restaurants -- <companyCode> [--dry-run]');
    process.exit(1);
  }
  const isDryRun = args.includes('--dry-run');

  const { db } = await import('../src/lib/firebase');

  console.log(`[시작] company=${companyCode} dry-run=${isDryRun}`);

  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  if (snap.empty) { console.log('가맹점 없음'); return; }

  const docs: RestaurantDoc[] = snap.docs.map(d => ({
    _id: d.id,
    name: (d.data().name as string) ?? '',
    address: (d.data().address as string) ?? '',
    lat: (d.data().lat as number) ?? 0,
    lng: (d.data().lng as number) ?? 0,
    source: (d.data().source as string) ?? 'opendata',
  }));

  console.log(`[로드] ${docs.length}개 가맹점`);

  // ── 중복 감지 ─────────────────────────────────────────────────
  const toDelete = new Set<string>();          // 확실한 중복 → 삭제
  const suspicious: Array<{ keep: RestaurantDoc; remove: RestaurantDoc; reason: string }> = [];
  const processed = new Set<string>();

  for (let i = 0; i < docs.length; i++) {
    if (processed.has(docs[i]._id)) continue;
    const a = docs[i];

    for (let j = i + 1; j < docs.length; j++) {
      if (processed.has(docs[j]._id)) continue;
      const b = docs[j];

      const nameSim = similarity(a.name, b.name);
      const distM = haversine(a.lat, a.lng, b.lat, b.lng);
      const addrA = normalizeAddress(a.address);
      const addrB = normalizeAddress(b.address);
      const sameAddr = addrA === addrB && addrA.length > 5;

      // [확실한 중복]: 주소 핵심부 동일 + 이름 유사도 85% 이상
      if (sameAddr && nameSim >= 0.85) {
        const keep = sourcePriority(a.source) >= sourcePriority(b.source) ? a : b;
        const remove = keep._id === a._id ? b : a;
        if (!toDelete.has(keep._id)) {
          toDelete.add(remove._id);
          processed.add(remove._id);
        }
        continue;
      }

      // [의심 중복]: 이름 유사도 70% 이상 + 80m 이내
      if (nameSim >= 0.70 && distM <= 80) {
        const keep = sourcePriority(a.source) >= sourcePriority(b.source) ? a : b;
        const remove = keep._id === a._id ? b : a;
        suspicious.push({
          keep,
          remove,
          reason: `이름유사도=${(nameSim * 100).toFixed(0)}% 거리=${distM.toFixed(0)}m`,
        });
      }
    }
  }

  // ── 결과 출력 ─────────────────────────────────────────────────
  console.log(`
=== 확실한 중복 (자동 삭제 대상): ${toDelete.size}건 ===`);
  for (const id of toDelete) {
    const d = docs.find(x => x._id === id)!;
    console.log(`  🗑  [${d.source}] ${d.name} | ${d.address}`);
  }

  console.log(`
=== 의심 중복 (수동 확인 필요): ${suspicious.length}건 ===`);
  for (const { keep, remove, reason } of suspicious) {
    if (toDelete.has(remove._id) || toDelete.has(keep._id)) continue; // 이미 삭제 예정
    console.log(`  ⚠️  ${reason}`);
    console.log(`     유지: [${keep.source}] ${keep.name} | ${keep.address}`);
    console.log(`     삭제?: [${remove.source}] ${remove.name} | ${remove.address}`);
  }

  console.log(`
=== 요약 ===`);
  console.log(`현재 총: ${docs.length}개`);
  console.log(`확실한 중복 삭제 대상: ${toDelete.size}개`);
  console.log(`삭제 후 예상: ${docs.length - toDelete.size}개`);
  console.log(`의심 중복 (수동 검토): ${suspicious.filter(s => !toDelete.has(s.remove._id) && !toDelete.has(s.keep._id)).length}건`);

  if (isDryRun) {
    console.log(`
[dry-run] 실제 삭제는 수행하지 않습니다. --dry-run 없이 실행하면 위 ${toDelete.size}건이 삭제됩니다.`);
    return;
  }

  if (toDelete.size === 0) {
    console.log('\n삭제할 확실한 중복이 없습니다.');
    return;
  }

  // ── Firestore 삭제 ────────────────────────────────────────────
  const restaurantsRef = db.collection('companies').doc(companyCode).collection('restaurants');
  const BATCH_SIZE = 400;
  let deleted = 0;
  const ids = [...toDelete];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.delete(restaurantsRef.doc(id));
    }
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, ids.length - i);
    console.log(`  ...${deleted}/${toDelete.size}건 삭제 완료`);
  }

  console.log(`
[완료] ${deleted}건 삭제, ${docs.length - deleted}건 남음`);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
