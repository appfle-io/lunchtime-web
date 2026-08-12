// 가맹점 중복 감지 및 안전 병합/정리 스크립트.
//
// 사용법:
//   npm run dedupe:restaurants -- ssg --dry-run   (삭제 없이 백업 검증 및 리포트만 출력)
//   npm run dedupe:restaurants -- ssg             (사전 백업 + 병합 + 이관 + 실제 삭제)
//
// 중복 판단 기준:
//   1. [동일 네이버 장소] naverPlaceId / naverPlaceUrl 이 일치하는 경우 → 100% 확실한 중복
//   2. [동일 전화번호+주소/거리] 전화번호 동일 + (주소 핵심부 동일 OR 거리 <= 100m) → 확실한 중복
//   3. [동일 주소+유사상호] 도로명 주소 핵심부 동일 + (이름 유사도 >= 0.70 OR 한쪽 이름이 포함관계) → 확실한 중복
//
// 보존 및 병합 규칙:
//   - 보존(Keep) 우선순위: 
//     1) isActive=true (활성 문서 우선)
//     2) 메뉴 정보가 풍부한 문서 우선
//     3) 최신 갱신 타임스탬프(naverEnrichedAt / zeroPayEnrichedAt)가 더 최근인 문서
//     4) source 신뢰도 (manual > seed > opendata)
//   - 제로페이 상태(isZeroPay): 한쪽이라도 true인 경우 isZeroPay=true 유지
//   - 서브컬렉션 이관: reviews, votes 서브컬렉션을 keep 문서로 100% 이관
//   - 백업: 작업 시작 시 .dedupe-backups 디렉토리에 전체 JSON 스냅샷 저장

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import type { RestaurantMenuItem } from '../src/types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function similarity(a: string, b: string): number {
  const sa = new Set(a.replace(/\s/g, '').split(''));
  const sb = new Set(b.replace(/\s/g, '').split(''));
  const intersection = [...sa].filter(c => sb.has(c)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : intersection / union;
}

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

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

function parseTimestamp(ts?: string): number {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
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
  naverPlaceId?: string;
  naverMatchedName?: string;
  menus?: RestaurantMenuItem[];
  isZeroPay?: boolean;
  isActive?: boolean;
  naverEnrichedAt?: string;
  zeroPayEnrichedAt?: string;
  seededAt?: string;
  addedAt?: string;
  raw: Record<string, any>;
}

async function main() {
  const args = process.argv.slice(2);
  const companyCode = args.find(a => !a.startsWith('--'));
  if (!companyCode) {
    console.error('사용법: npm run dedupe:restaurants -- <companyCode> [--dry-run]');
    process.exit(1);
  }
  const isDryRun = args.includes('--dry-run');

  const { db } = await import('../src/lib/firebase');
  const { normalizeName, getCoreRoadAddress } = await import('../src/lib/restaurant-server');

  console.log(`[시작] company=${companyCode} dry-run=${isDryRun}`);

  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  if (snap.empty) { console.log('가맹점 없음'); return; }

  const docs: RestaurantDoc[] = snap.docs.map(d => {
    const data = d.data();
    return {
      _id: d.id,
      name: (data.name as string) ?? '',
      address: (data.address as string) ?? '',
      phone: (data.phone as string) ?? '',
      lat: (data.lat as number) ?? 0,
      lng: (data.lng as number) ?? 0,
      source: (data.source as string) ?? 'opendata',
      naverPlaceUrl: (data.naverPlaceUrl as string) ?? undefined,
      naverPlaceId: (data.naverPlaceId as string) ?? undefined,
      naverMatchedName: (data.naverMatchedName as string) ?? undefined,
      menus: Array.isArray(data.menus) ? (data.menus as RestaurantMenuItem[]) : undefined,
      isZeroPay: Boolean(data.isZeroPay),
      isActive: data.isActive !== false,
      naverEnrichedAt: data.naverEnrichedAt as string | undefined,
      zeroPayEnrichedAt: data.zeroPayEnrichedAt as string | undefined,
      seededAt: data.seededAt as string | undefined,
      addedAt: data.addedAt as string | undefined,
      raw: data,
    };
  });

  console.log(`[로드] ${docs.length}개 가맹점 데이터 분석 완료`);

  // ── 사전 백업 스냅샷 ──────────────────────────────────────────────
  const backupDir = path.resolve(process.cwd(), '.dedupe-backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `backup-${companyCode}-${timestampStr}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(docs.map(d => ({ id: d._id, ...d.raw })), null, 2), 'utf8');
  console.log(`[백업] 전체 가맹점 백업 저장 완료: ${backupPath}`);

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
      const nameContains = cleanNameA.includes(cleanNameB) || cleanNameB.includes(cleanNameA);

      const distM = haversine(a.lat, a.lng, b.lat, b.lng);
      const coreAddrA = getCoreRoadAddress(a.address);
      const coreAddrB = getCoreRoadAddress(b.address);
      const sameCoreAddr = coreAddrA === coreAddrB && coreAddrA.length > 5;

      const phoneA = normalizePhone(a.phone);
      const phoneB = normalizePhone(b.phone);
      const samePhone = phoneA.length > 0 && phoneA === phoneB;

      const sameNaverPlaceId = Boolean(a.naverPlaceId && b.naverPlaceId && a.naverPlaceId === b.naverPlaceId);
      const sameNaverUrl = Boolean(a.naverPlaceUrl && b.naverPlaceUrl && a.naverPlaceUrl === b.naverPlaceUrl);
      const sameNaverPlace = sameNaverPlaceId || sameNaverUrl;

      // [확실한 중복 조건]
      // 1) 네이버 Place ID/URL 이 완전히 동일한 경우
      // 2) 전화번호 동일 + (주소 핵심부 동일 OR 거리 100m 이내)
      // 3) 주소 핵심부 동일 + (이름 유사도 >= 0.70 OR 이름 포함관계 OR 정규화 이름 동일)
      const isDefiniteDuplicate =
        sameNaverPlace ||
        (samePhone && (sameCoreAddr || distM <= 100)) ||
        (sameCoreAddr && (nameSim >= 0.70 || nameContains || exactCleanName));

      if (isDefiniteDuplicate) {
        // 보존 우선순위 선정 로직:
        // 1순위: isActive=true 인 항목 우선 (활성 매장 보존)
        // 2순위: 메뉴 개수가 더 많은 항목
        // 3순위: naverEnrichedAt / zeroPayEnrichedAt 타임스탬프가 더 최근인 항목
        // 4순위: source 신뢰도 (manual > seed > opendata)
        let keep = a;
        let remove = b;

        if (a.isActive && !b.isActive) {
          keep = a; remove = b;
        } else if (b.isActive && !a.isActive) {
          keep = b; remove = a;
        } else {
          const aMenusCount = a.menus?.length ?? 0;
          const bMenusCount = b.menus?.length ?? 0;
          if (aMenusCount !== bMenusCount) {
            keep = aMenusCount > bMenusCount ? a : b;
            remove = keep._id === a._id ? b : a;
          } else {
            const aTime = Math.max(parseTimestamp(a.naverEnrichedAt), parseTimestamp(a.zeroPayEnrichedAt));
            const bTime = Math.max(parseTimestamp(b.naverEnrichedAt), parseTimestamp(b.zeroPayEnrichedAt));
            if (aTime !== bTime) {
              keep = aTime > bTime ? a : b;
              remove = keep._id === a._id ? b : a;
            } else {
              keep = sourcePriority(a.source) >= sourcePriority(b.source) ? a : b;
              remove = keep._id === a._id ? b : a;
            }
          }
        }

        if (!toDeleteMap.has(keep._id)) {
          toDeleteMap.set(remove._id, keep);
          processed.add(remove._id);
        }
        continue;
      }

      // [의심 중복]
      if (nameSim >= 0.60 && distM <= 100) {
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

  // ── 리포트 출력 ─────────────────────────────────────────────────
  console.log(`\n=== 확실한 중복 (자동 병합 및 삭제 대상): ${toDeleteMap.size}건 ===`);
  for (const [removeId, keep] of toDeleteMap.entries()) {
    const remove = docs.find(x => x._id === removeId)!;
    console.log(`  🗑  삭제 예정: [${remove.source}] ${remove.name} (${remove._id}) | 주소: ${remove.address} | isZeroPay: ${remove.isZeroPay} | active: ${remove.isActive}`);
    console.log(`     유지 대상: [${keep.source}] ${keep.name} (${keep._id}) | 주소: ${keep.address} | isZeroPay: ${keep.isZeroPay} | active: ${keep.isActive}`);
  }

  console.log(`\n=== 의심 중복 (수동 검토 필요): ${suspicious.length}건 ===`);
  for (const { keep, remove, reason } of suspicious) {
    if (toDeleteMap.has(remove._id) || toDeleteMap.has(keep._id)) continue;
    console.log(`  ⚠️  ${reason}`);
    console.log(`     유지: [${keep.source}] ${keep.name} | ${keep.address}`);
    console.log(`     삭제?: [${remove.source}] ${remove.name} | ${remove.address}`);
  }

  const remainingSuspicious = suspicious.filter(s => !toDeleteMap.has(s.remove._id) && !toDeleteMap.has(s.keep._id));

  console.log(`\n=== 요약 ===`);
  console.log(`현재 총 식당 수: ${docs.length}개`);
  console.log(`병합 및 삭제 대상: ${toDeleteMap.size}개`);
  console.log(`병합 후 최종 예상 수: ${docs.length - toDeleteMap.size}개`);
  console.log(`의심 중복 (수동 검토): ${remainingSuspicious.length}건`);

  if (isDryRun) {
    console.log(`\n[dry-run 완료] 실제 DB 수정 및 삭제는 진행되지 않았습니다. --dry-run 없이 실행 시 병합이 수행됩니다.`);
    return;
  }

  if (toDeleteMap.size === 0) {
    console.log('\n삭제할 확실한 중복이 없습니다.');
    return;
  }

  // ── Firestore 데이터 병합 및 삭제 ─────────────────
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

    // 1) 제로페이 승인 여부 보존: 한쪽이라도 true이면 true 유지
    if (!keepData.isZeroPay && removeData.isZeroPay) {
      mergedData.isZeroPay = true;
      if (removeData.zeroPayOfficialName) mergedData.zeroPayOfficialName = removeData.zeroPayOfficialName;
      if (removeData.zeroPayOfficialAddress) mergedData.zeroPayOfficialAddress = removeData.zeroPayOfficialAddress;
      if (removeData.zeroPaySource) mergedData.zeroPaySource = removeData.zeroPaySource;
      if (removeData.zeroPayEnrichedAt) mergedData.zeroPayEnrichedAt = removeData.zeroPayEnrichedAt;
    }

    // 2) 최신 타임스탬프 비교 기반 풍부한 정보 보완
    const removeNaverTime = parseTimestamp(removeData.naverEnrichedAt);
    const keepNaverTime = parseTimestamp(keepData.naverEnrichedAt);

    if ((!keepData.menus || keepData.menus.length === 0) || (removeNaverTime > keepNaverTime && removeData.menus?.length > 0)) {
      if (removeData.menus && removeData.menus.length > 0) mergedData.menus = removeData.menus;
    }
    if (!keepData.phone && removeData.phone) mergedData.phone = removeData.phone;
    if (!keepData.businessHours || (removeNaverTime > keepNaverTime && removeData.businessHours)) {
      if (removeData.businessHours) mergedData.businessHours = removeData.businessHours;
    }
    if (!keepData.facilities || (removeNaverTime > keepNaverTime && removeData.facilities)) {
      if (removeData.facilities) mergedData.facilities = removeData.facilities;
    }
    if (!keepData.paymentMethods || (removeNaverTime > keepNaverTime && removeData.paymentMethods)) {
      if (removeData.paymentMethods) mergedData.paymentMethods = removeData.paymentMethods;
    }
    if (!keepData.aiBriefing || (removeNaverTime > keepNaverTime && removeData.aiBriefing)) {
      if (removeData.aiBriefing) mergedData.aiBriefing = removeData.aiBriefing;
    }
    if (!keepData.naverPlaceUrl && removeData.naverPlaceUrl) mergedData.naverPlaceUrl = removeData.naverPlaceUrl;
    if (!keepData.naverPlaceId && removeData.naverPlaceId) mergedData.naverPlaceId = removeData.naverPlaceId;
    if (!keepData.naverMatchedName && removeData.naverMatchedName) mergedData.naverMatchedName = removeData.naverMatchedName;
    if (!keepData.categoryLabel && removeData.categoryLabel) mergedData.categoryLabel = removeData.categoryLabel;

    // 병합된 필드가 있으면 update
    if (Object.keys(mergedData).length > 0) {
      await keepRef.set(mergedData, { merge: true });
      console.log(`  [병합] ${keep._id} 에 최신 필드 ${Object.keys(mergedData).join(', ')} 병합 완료`);
    }

    // 3) reviews 서브컬렉션 이관
    const reviewsSnap = await removeRef.collection('reviews').get();
    if (!reviewsSnap.empty) {
      for (const revDoc of reviewsSnap.docs) {
        await keepRef.collection('reviews').doc(revDoc.id).set(revDoc.data());
        await revDoc.ref.delete();
      }
      console.log(`  [이관] ${removeId} -> ${keep._id} 리뷰 ${reviewsSnap.size}건 이관 완료`);
    }

    // 4) votes (제로페이 투표) 서브컬렉션 이관
    const votesSnap = await removeRef.collection('votes').get();
    if (!votesSnap.empty) {
      for (const voteDoc of votesSnap.docs) {
        await keepRef.collection('votes').doc(voteDoc.id).set(voteDoc.data());
        await voteDoc.ref.delete();
      }
      console.log(`  [이관] ${removeId} -> ${keep._id} 제로페이 투표 ${votesSnap.size}건 이관 완료`);
    }

    await removeRef.delete();
    deleted++;
  }

  console.log(`\n[완료] ${deleted}건 중복 삭제 및 최신 데이터 병합 완료! (최종 남은 식당 수: ${docs.length - deleted}개)`);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
