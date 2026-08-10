// 가맹점 중복 감지 및 정리 스크립트.
//
// 사용법:
//   npm run dedupe:restaurants -- ssg --dry-run   (삭제 없이 중복 리포트만 출력)
//   npm run dedupe:restaurants -- ssg             (실제 삭제 실행)
//
// 중복 판단 기준 (3단계):
//   1. [확실한 중복]     도로명 주소 핵심부가 같고 이름 유사도 >= 0.85 → 자동 삭제
//   2. [의심 중복]       이름 유사도 >= 0.70 AND 직선거리 <= 80m    → 리포트만 출력
//   3. [전화+주소 일치]  전화번호(숫자만) 동일 AND 주소 핵심부 동일 AND 이름 유사도 >= 0.50
//                        → 리포트만 출력(자동 삭제 안 함) - 2026-08-10 신규 요청. 전화+주소가
//                        정확히 같으면 사실상 같은 매장이 거의 확실하지만, enrich 스크립트가 아직
//                        전화번호를 못 채운 문서가 많아서(phone이 없는 경우 비교 자체를 건너뜀)
//                        1번(주소+이름 85%) 기준과 겹치지 않는 새로운 건들이 나올 수 있다.
//                        자동 삭제 대상엔 안 넣고 사람이 눈으로 확인하고 지우도록 리포트만 낸다.
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
// ──────────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────────

/** 전화번호에서 숫자만 남긴다("02-1234-5678" -> "0212345678"). 비교 전 하이픈/공백 차이를 무시. */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
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
  phone: string;
  lat: number;
  lng: number;
  source: string;
  naverPlaceUrl?: string;
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
  const { normalizeAddress, normalizeName, getCoreRoadAddress } = await import('../src/lib/restaurant-server');

  console.log(`[시작] company=${companyCode} dry-run=${isDryRun}`);

  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  if (snap.empty) { console.log('가맹점 없음'); return; }

  const docs: RestaurantDoc[] = snap.docs.map(d => ({
    _id: d.id,
    name: (d.data().name as string) ?? '',
    address: (d.data().address as string) ?? '',
    phone: (d.data().phone as string) ?? '',
    lat: (d.data().lat as number) ?? 0,
    lng: (d.data().lng as number) ?? 0,
    source: (d.data().source as string) ?? 'opendata',
    naverPlaceUrl: (d.data().naverPlaceUrl as string) ?? undefined,
  }));

  console.log(`[로드] ${docs.length}개 가맹점`);

  // ── 중복 감지 ─────────────────────────────────────────────────
  const toDeleteMap = new Map<string, RestaurantDoc>(); // removeId -> keepDoc
  const suspicious: Array<{ keep: RestaurantDoc; remove: RestaurantDoc; reason: string }> = [];
  const processed = new Set<string>();

  for (let i = 0; i < docs.length; i++) {
    if (processed.has(docs[i]._id)) continue;
    const a = docs[i];

    for (let j = i + 1; j < docs.length; j++) {
      if (processed.has(docs[j]._id)) continue;
      const b = docs[j];

      const nameSim = similarity(a.name, b.name);
      const cleanNameA = normalizeName(a.name);
      const cleanNameB = normalizeName(b.name);
      const exactCleanName = cleanNameA === cleanNameB;

      const distM = haversine(a.lat, a.lng, b.lat, b.lng);
      const coreAddrA = getCoreRoadAddress(a.address);
      const coreAddrB = getCoreRoadAddress(b.address);
      const sameCoreAddr = coreAddrA === coreAddrB && coreAddrA.length > 5;

      const phoneA = normalizePhone(a.phone);
      const phoneB = normalizePhone(b.phone);
      const samePhone = phoneA.length > 0 && phoneA === phoneB;

      const sameNaverUrl = Boolean(a.naverPlaceUrl && b.naverPlaceUrl && a.naverPlaceUrl === b.naverPlaceUrl);

      // [확실한 중복 기준 1]: 핵심 도로명 주소 동일 + (이름 유사도 85% 이상 OR 공백제거 동일 이름)
      // [확실한 중복 기준 2]: 동일 전화번호 + (핵심 도로명 주소 동일 OR 동일 네이버 URL) + 이름 유사도 50% 이상
      // [확실한 중복 기준 3]: 동일 네이버 URL + 이름 유사도 80% 이상
      const isDefiniteDuplicate =
        (sameCoreAddr && (nameSim >= 0.85 || exactCleanName)) ||
        (samePhone && (sameCoreAddr || sameNaverUrl || distM <= 100) && nameSim >= 0.50) ||
        (sameNaverUrl && nameSim >= 0.80);

      if (isDefiniteDuplicate) {
        // 보존 우선순위: 1순위 메뉴가 있는 문서 -> 2순위 manual > seed > opendata
        const aHasMenus = Array.isArray(a.menus) && a.menus.length > 0;
        const bHasMenus = Array.isArray(b.menus) && b.menus.length > 0;
        let keep = a;
        let remove = b;

        if (aHasMenus && !bHasMenus) {
          keep = a; remove = b;
        } else if (bHasMenus && !aHasMenus) {
          keep = b; remove = a;
        } else if (aHasMenus && bHasMenus && a.menus!.length !== b.menus!.length) {
          keep = a.menus!.length > b.menus!.length ? a : b;
          remove = keep._id === a._id ? b : a;
        } else {
          keep = sourcePriority(a.source) >= sourcePriority(b.source) ? a : b;
          remove = keep._id === a._id ? b : a;
        }

        if (!toDeleteMap.has(keep._id)) {
          toDeleteMap.set(remove._id, keep);
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
=== 확실한 중복 (자동 삭제 대상): ${toDeleteMap.size}건 ===`);
  for (const [removeId, keep] of toDeleteMap.entries()) {
    const remove = docs.find(x => x._id === removeId)!;
    console.log(`  🗑  삭제: [${remove.source}] ${remove.name} (${remove._id}) | ${remove.address}`);
    console.log(`     유지: [${keep.source}] ${keep.name} (${keep._id}) | ${keep.address}`);
  }

  console.log(`
=== 의심 중복 (수동 확인 필요): ${suspicious.length}건 ===`);
  for (const { keep, remove, reason } of suspicious) {
    if (toDeleteMap.has(remove._id) || toDeleteMap.has(keep._id)) continue; // 이미 삭제 예정
    console.log(`  ⚠️  ${reason}`);
    console.log(`     유지: [${keep.source}] ${keep.name} | ${keep.address}`);
    console.log(`     삭제?: [${remove.source}] ${remove.name} | ${remove.address}`);
  }

  const remainingSuspicious = suspicious.filter(s => !toDeleteMap.has(s.remove._id) && !toDeleteMap.has(s.keep._id));

  console.log(`
=== 요약 ===`);
  console.log(`현재 총: ${docs.length}개`);
  console.log(`확실한 중복 삭제 대상: ${toDeleteMap.size}개`);
  console.log(`삭제 후 예상: ${docs.length - toDeleteMap.size}개`);
  console.log(`의심 중복 (수동 검토): ${remainingSuspicious.length}건`);

  if (isDryRun) {
    console.log(`
[dry-run] 실제 삭제는 수행하지 않습니다. --dry-run 없이 실행하면 위 ${toDeleteMap.size}건이 삭제됩니다.`);
    return;
  }

  if (toDeleteMap.size === 0) {
    console.log('\n삭제할 확실한 중복이 없습니다.');
    return;
  }

  // ── Firestore 삭제 및 서브컬렉션 마이그레이션 ─────────────────
  const restaurantsRef = db.collection('companies').doc(companyCode).collection('restaurants');
  let deleted = 0;

  for (const [removeId, keep] of toDeleteMap.entries()) {
    const removeRef = restaurantsRef.doc(removeId);
    const keepRef = restaurantsRef.doc(keep._id);

    const removeSnap = await removeRef.get();
    const removeData = removeSnap.data() || {};
    const keepSnap = await keepRef.get();
    const keepData = keepSnap.data() || {};

    const mergedData: Record<string, any> = {};
    if ((!keepData.menus || keepData.menus.length === 0) && removeData.menus && removeData.menus.length > 0) {
      mergedData.menus = removeData.menus;
    }
    if (!keepData.phone && removeData.phone) mergedData.phone = removeData.phone;
    if (!keepData.businessHours && removeData.businessHours) mergedData.businessHours = removeData.businessHours;
    if (!keepData.facilities && removeData.facilities) mergedData.facilities = removeData.facilities;
    if (!keepData.paymentMethods && removeData.paymentMethods) mergedData.paymentMethods = removeData.paymentMethods;
    if (!keepData.aiBriefing && removeData.aiBriefing) mergedData.aiBriefing = removeData.aiBriefing;
    if (!keepData.naverPlaceUrl && removeData.naverPlaceUrl) mergedData.naverPlaceUrl = removeData.naverPlaceUrl;
    if (!keepData.naverPlaceId && removeData.naverPlaceId) mergedData.naverPlaceId = removeData.naverPlaceId;

    if (Object.keys(mergedData).length > 0) {
      await keepRef.set(mergedData, { merge: true });
    }

    // reviews 서브컬렉션 마이그레이션
    const reviewsSnap = await removeRef.collection('reviews').get();
    if (!reviewsSnap.empty) {
      for (const revDoc of reviewsSnap.docs) {
        await keepRef.collection('reviews').doc(revDoc.id).set(revDoc.data());
        await revDoc.ref.delete();
      }
      console.log(`  [이관] ${removeId} -> ${keep._id} 리뷰 ${reviewsSnap.size}건 이관 완료`);
    }

    await removeRef.delete();
    deleted++;
  }

  console.log(`
[완료] ${deleted}건 삭제, ${docs.length - deleted}건 남음`);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
