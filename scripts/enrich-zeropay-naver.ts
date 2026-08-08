// DB에 등록된 가맹점의 제로페이 여부를 네이버맵에서 일괄 조회하여 업데이트하는 배치 스크립트.
//
// 사용법:
//   npm run enrich:zeropay -- ssg                     (전체 실행)
//   npm run enrich:zeropay -- ssg --dry-run            (DB 업데이트 없이 결과만 출력)
//   npm run enrich:zeropay -- ssg --limit=20           (처음 20개만)
//   npm run enrich:zeropay -- ssg --parallel=3         (브라우저 3개 병렬 - 기본 1)
//   npm run enrich:zeropay -- ssg --from=50            (50번째부터 재개)
//
// 동작:
//   1. Firestore에서 restaurants 전체 목록을 읽는다.
//   2. company.districtCode → 지역 필터 키워드 생성 ("영등포구" → "영등포")
//   3. Playwright 헤드리스 브라우저로 네이버맵 조회 (병렬 지원)
//   4. isZeroPay / naverPlaceId / phone / zeroPaySource / naverCategory 업데이트
//   5. 체크포인트 파일로 중단 후 재시작 지원
//
// 주의: 네이버 이용약관상 크롤링은 허용되지 않는다. 초기 데이터 적재 1회 용도로만 사용.

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const CHECKPOINT_FILE = path.resolve(process.cwd(), '.enrich-checkpoint.json');

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

async function main() {
  const { db } = await import('../src/lib/firebase');
  const { chromium } = await import('playwright');

  // ── 인수 파싱 ──────────────────────────────────────────────────
  const args = process.argv.slice(2);
  const companyCode = args.find(a => !a.startsWith('--'));
  if (!companyCode) {
    console.error('사용법: npm run enrich:zeropay -- <companyCode> [--dry-run] [--limit=N] [--parallel=N] [--from=N]');
    process.exit(1);
  }
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const parallelArg = args.find(a => a.startsWith('--parallel='));
  const parallel = Math.min(parallelArg ? Number(parallelArg.split('=')[1]) : 1, 5);
  const fromArg = args.find(a => a.startsWith('--from='));
  const fromIndex = fromArg ? Number(fromArg.split('=')[1]) : 0;
  const resetCheckpoint = args.includes('--reset');

  // ── company 문서 읽기 ──────────────────────────────────────────
  const companySnap = await db.collection('companies').doc(companyCode).get();
  if (!companySnap.exists) {
    console.error(`companies/${companyCode} 문서를 찾을 수 없습니다.`);
    process.exit(1);
  }
  const rawDistrict: string = companySnap.data()?.districtCode ?? '';
  const districtKeyword = rawDistrict.replace(/(구|시|군)$/, '').trim();

  console.log(
    `[시작] company=${companyCode} district="${rawDistrict}" filter="${districtKeyword || '(없음)'}"` +
    ` parallel=${parallel} dry-run=${isDryRun}`
  );

  // ── 체크포인트 로드 ─────────────────────────────────────────────
  const checkpoint = resetCheckpoint ? new Set<string>() : loadCheckpoint();
  if (checkpoint.size > 0) {
    console.log(`[체크포인트] 이미 처리된 ${checkpoint.size}건 건너뜀 (--reset으로 초기화)`);
  }

  // ── Firestore 가맹점 목록 ──────────────────────────────────────
  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  if (snap.empty) { console.log('가맹점 없음'); return; }

  let docs = snap.docs.filter(d => d.data().zeroPaySource !== 'manual');
  if (fromIndex > 0) docs = docs.slice(fromIndex);
  if (limit !== Infinity) docs = docs.slice(0, limit);

  // 이미 처리된 건 제외
  const pending = docs.filter(d => !checkpoint.has(d.id));
  console.log(`[대상] ${snap.size}건 중 ${pending.length}건 미처리 (전체 ${docs.length}건 중)\n`);

  if (pending.length === 0) {
    console.log('처리할 항목이 없습니다. --reset으로 체크포인트를 초기화할 수 있습니다.');
    return;
  }

  // ── Playwright 병렬 처리 ────────────────────────────────────────
  const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const PAYMENT_KEYWORDS = ['제로페이', '네이버페이', '카카오페이', '삼성페이', '애플페이', '신용카드', '체크카드', '현금'];

  const browser = await chromium.launch({ headless: true });
  const results = new Map<string, {
    isZeroPay: boolean;
    paymentMethods: string[];
    naverPlaceId: string | null;
    matchedName: string | null;
    matchedAddress: string | null;
    phone: string | null;
  }>();

  let doneCount = 0;
  const total = pending.length;

  // 워커 함수
  async function processChunk(chunk: typeof pending) {
    const context = await browser.newContext({ locale: 'ko-KR', userAgent: BROWSER_UA });

    for (const doc of chunk) {
      const name = doc.data().name as string;
      let naverPlaceId: string | null = null;
      let matchedName: string | null = null;
      let matchedAddress: string | null = null;
      let isZeroPay = false;
      let paymentMethods: string[] = [];
      let phone: string | null = null;

      try {
        // Step 1: 검색 → placeId
        const searchPage = await context.newPage();
        let captured = false;
        searchPage.on('response', async (response) => {
          if (captured) return;
          const url = response.url();
          if (!url.includes('/api/search/allSearch') && !url.includes('/api/search/place')) return;
          try {
            const json = await response.json().catch(() => null);
            if (!json) return;
            const places = json?.result?.place?.list ?? json?.result?.place?.items ?? [];
            for (const p of places) {
              const pid = String(p.id ?? p.placeId ?? '');
              const pname = String(p.name ?? p.title ?? '');
              const paddr = String(p.roadAddress ?? p.address ?? p.jibunAddress ?? '');
              if (!pid) continue;
              if (districtKeyword && !paddr.includes(districtKeyword)) continue;
              naverPlaceId = pid;
              matchedName = pname;
              matchedAddress = paddr;
              captured = true;
              break;
            }
            // 지역 필터 통과 못하면 첫번째라도 저장
            if (!captured && places.length > 0) {
              const p = places[0];
              const pid = String(p.id ?? p.placeId ?? '');
              if (pid && districtKeyword) {
                // 지역 필터 실패 → null 유지 (잘못 매핑 방지)
              } else if (pid) {
                naverPlaceId = pid;
                matchedName = String(p.name ?? p.title ?? '');
                matchedAddress = String(p.roadAddress ?? p.address ?? '');
                captured = true;
              }
            }
          } catch (_) {}
        });
        await searchPage.goto(`https://map.naver.com/p/search/${encodeURIComponent(name)}`, { waitUntil: 'load', timeout: 30000 });
        await searchPage.waitForTimeout(5000);
        await searchPage.close();

        // Step 2: 엄격한 제로페이 후기/가맹점 exact match 검증 (아웃백/스타벅스/소소한날 -> false, 동남집/호박집 -> true)
        if (matchedName) {
          const q1 = encodeURIComponent('"' + matchedName + '" "제로페이 결제"');
          const q2 = encodeURIComponent('"' + matchedName + '" "제로페이 가맹점"');
          const q3 = encodeURIComponent('"' + matchedName + '" "영등포사랑상품권"');

          const infoPage = await context.newPage();
          try {
            // 전화번호 수집 시도
            if (naverPlaceId) {
              try {
                await infoPage.goto(`https://pcmap.place.naver.com/restaurant/${naverPlaceId}/info`, { waitUntil: 'domcontentloaded', timeout: 12000 });
                await infoPage.waitForTimeout(1200);
                const pagePhone = await infoPage.evaluate(() => {
                  const win = window as any;
                  const apollo = win.__APOLLO_STATE__;
                  if (!apollo) return null;
                  for (const k of Object.keys(apollo)) {
                    const item = apollo[k];
                    if (item && typeof item.phone === 'string' && item.phone) return item.phone;
                  }
                  return null;
                });
                if (pagePhone) phone = pagePhone;
              } catch (_) {}
            }

            // 제로페이 검증 (3가지 exact match 쿼리)
            for (const q of [q1, q2, q3]) {
              await infoPage.goto(`https://search.naver.com/search.naver?where=blog&query=${q}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
              await infoPage.waitForTimeout(800);
              const hasResult = await infoPage.evaluate(() => !document.body.innerText.includes('검색결과가 없습니다'));
              if (hasResult) {
                isZeroPay = true;
                paymentMethods = ['제로페이/영등포사랑상품권'];
                break;
              }
            }
          } catch (_) {}
          await infoPage.close();
        }
      } catch (err) {
        console.warn(`  [경고] "${name}" 처리 중 오류: ${(err as Error).message?.slice(0, 80)}`);
      }

      results.set(doc.id, { isZeroPay, paymentMethods, naverPlaceId, matchedName, matchedAddress, phone });
      checkpoint.add(doc.id);

      doneCount++;
      const icon = naverPlaceId ? (isZeroPay ? '🟢' : '🔴') : '⚠️';
      console.log(`  [${doneCount}/${total}] ${icon} ${name}`);
      if (naverPlaceId) console.log(`          → ${matchedName} | ${matchedAddress}`);
      if (paymentMethods.length) console.log(`          결제: ${paymentMethods.join(', ')}`);

      // 5건마다 체크포인트 저장
      if (doneCount % 5 === 0) saveCheckpoint(checkpoint);

      await new Promise(r => setTimeout(r, 800));
    }

    await context.close();
  }

  // 청크 분배
  const chunkSize = Math.ceil(pending.length / parallel);
  const chunks = Array.from({ length: parallel }, (_, i) => pending.slice(i * chunkSize, (i + 1) * chunkSize));

  try {
    await Promise.all(chunks.map(chunk => processChunk(chunk)));
  } finally {
    saveCheckpoint(checkpoint);
    await browser.close();
  }

  // ── Firestore 업데이트 ──────────────────────────────────────────
  if (isDryRun) {
    console.log('\n[dry-run] DB 업데이트를 건너뜁니다.');
  } else {
    console.log('\n[DB 업데이트 중...]');
    const restaurantsRef = db.collection('companies').doc(companyCode).collection('restaurants');
    const WRITE_BATCH = 400;
    let updated = 0;
    let failed = 0;
    const entries = [...results.entries()];

    for (let i = 0; i < entries.length; i += WRITE_BATCH) {
      const batch = db.batch();
      for (const [id, r] of entries.slice(i, i + WRITE_BATCH)) {
        if (!r.naverPlaceId) { failed++; continue; }
        const update: Record<string, unknown> = {
          isZeroPay: r.isZeroPay,
          zeroPaySource: 'naver_map',
          naverPlaceId: r.naverPlaceId,
          naverMatchedName: r.matchedName,
          naverMatchedAddress: r.matchedAddress,
          zeroPayEnrichedAt: new Date().toISOString(),
        };
        if (r.phone) update.phone = r.phone;
        batch.update(restaurantsRef.doc(id), update);
        updated++;
      }
      await batch.commit();
      console.log(`  ...${Math.min(i + WRITE_BATCH, entries.length)}/${entries.length}건 커밋`);
    }
    console.log(`\n[DB 완료] 업데이트: ${updated}건 / 조회실패(naverPlaceId 없음): ${failed}건`);
  }

  // 체크포인트 클리어 (완료)
  if (!isDryRun) {
    try { fs.unlinkSync(CHECKPOINT_FILE); } catch (_) {}
    console.log('[체크포인트 삭제 완료]');
  }

  // ── 최종 요약 ─────────────────────────────────────────────────
  const zp = [...results.values()].filter(r => r.isZeroPay).length;
  const notZp = [...results.values()].filter(r => r.naverPlaceId && !r.isZeroPay).length;
  const noId = [...results.values()].filter(r => !r.naverPlaceId).length;
  console.log('\n=== 최종 요약 ===');
  console.log(`🟢 제로페이 가맹점: ${zp}건`);
  console.log(`🔴 비가맹점: ${notZp}건`);
  console.log(`⚠️  조회 실패: ${noId}건`);
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
