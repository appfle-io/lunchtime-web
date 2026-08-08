import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { checkZeroPayOfficial } from '../src/lib/zeropay-official';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const CHECKPOINT_FILE = path.resolve(process.cwd(), '.enrich-official-checkpoint.json');

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

  const args = process.argv.slice(2);
  const companyCode = args.find(a => !a.startsWith('--'));
  if (!companyCode) {
    console.error('사용법: npm run enrich:zeropay-official -- <companyCode> [--dry-run] [--limit=N] [--reset]');
    process.exit(1);
  }

  const isDryRun = args.includes('--dry-run');
  const resetCheckpoint = args.includes('--reset');

  const checkpoint = resetCheckpoint ? new Set<string>() : loadCheckpoint();

  console.log(`[공식 제로페이 검증 (주소 일치율 정합성 3단계 탑재)] company=${companyCode} dry-run=${isDryRun}`);

  const snap = await db.collection('companies').doc(companyCode).collection('restaurants').get();
  if (snap.empty) {
    console.log('가맹점 없음');
    return;
  }

  const pending = snap.docs.filter(d => !checkpoint.has(d.id));
  console.log(`[대상] 총 ${snap.size}건 중 미처리 ${pending.length}건\n`);

  if (pending.length === 0) {
    console.log('모든 가맹점 검증이 완료되었습니다.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const results = new Map<string, {
    isZeroPay: boolean;
    officialName?: string;
    officialAddress?: string;
    bizType?: string;
    isNotFoodBiz?: boolean;
  }>();

  let doneCount = 0;
  const total = pending.length;
  const toDeleteIds: string[] = [];

  const context = await browser.newContext({ locale: 'ko-KR' });

  for (const doc of pending) {
    const name = doc.data().name as string;
    const address = doc.data().address as string ?? '';

    try {
      const res = await checkZeroPayOfficial(name, address, context);
      results.set(doc.id, {
        isZeroPay: res.isZeroPay,
        officialName: res.officialName,
        officialAddress: res.officialAddress,
        bizType: res.bizType,
        isNotFoodBiz: res.isNotFoodBiz,
      });

      doneCount++;

      if (res.isNotFoodBiz) {
        toDeleteIds.push(doc.id);
        console.log(`  [${doneCount}/${total}] 🗑️ (식당 아님/삭제 대상) ${name} [업종: ${res.bizType ?? '비음식점'}]`);
      } else if (res.isZeroPay) {
        console.log(`  [${doneCount}/${total}] 🟢 (공식 제로페이 가맹점) ${name}`);
        console.log(`          → 공식상호: ${res.officialName} [업종: ${res.bizType}] | ${res.officialAddress}`);
      } else {
        console.log(`  [${doneCount}/${total}] 🔴 (미가맹점/주소 불일치) ${name}`);
      }
    } catch (err) {
      console.warn(`  [오류] "${name}": ${(err as Error).message}`);
    }

    checkpoint.add(doc.id);
    if (doneCount % 5 === 0) saveCheckpoint(checkpoint);
    await new Promise(r => setTimeout(r, 1200));
  }

  await context.close();
  await browser.close();

  // ── Firestore 업데이트 & 이업종 식당 삭제 ────────────────────────
  if (isDryRun) {
    console.log('\n[dry-run] DB 업데이트 및 삭제를 건너뜁니다.');
  } else {
    console.log('\n[DB 업데이트 & 이업종 삭제 진행 중...]');
    const restaurantsRef = db.collection('companies').doc(companyCode).collection('restaurants');
    const WRITE_BATCH = 400;
    let updated = 0;
    let deleted = 0;

    const entries = [...results.entries()];

    for (let i = 0; i < entries.length; i += WRITE_BATCH) {
      const batch = db.batch();
      for (const [id, r] of entries.slice(i, i + WRITE_BATCH)) {
        if (r.isNotFoodBiz) {
          batch.delete(restaurantsRef.doc(id));
          deleted++;
        } else {
          batch.update(restaurantsRef.doc(id), {
            isZeroPay: r.isZeroPay,
            zeroPaySource: 'official_zeropay_api',
            zeroPayOfficialName: r.officialName ?? null,
            zeroPayOfficialAddress: r.officialAddress ?? null,
            zeroPayEnrichedAt: new Date().toISOString(),
          });
          updated++;
        }
      }
      await batch.commit();
    }
    console.log(`\n[DB 완료] 가맹점 갱신: ${updated}건 / 이업종 식당 삭제: ${deleted}건`);
  }

  if (!isDryRun) {
    try { fs.unlinkSync(CHECKPOINT_FILE); } catch (_) {}
  }
}

main().catch(err => { console.error('[실패]', err); process.exit(1); });
