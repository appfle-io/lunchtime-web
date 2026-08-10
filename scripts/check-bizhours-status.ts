import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkAllStoresBizHoursStatus() {
  const { db } = await import('../src/lib/firebase');
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();

  if (snap.empty) {
    console.log('가맹점이 없습니다.');
    return;
  }

  const docs = snap.docs;
  let hasBizHoursCount = 0;
  let emptyBizHoursCount = 0;

  const sampleStoresWithBizHours: Array<{ name: string; bizHours: any }> = [];
  const sampleStoresWithoutBizHours: string[] = [];

  for (const doc of docs) {
    const data = doc.data();
    const name = data.name as string;
    const bizHours = data.businessHours;

    if (bizHours && (typeof bizHours === 'string' ? bizHours.trim().length > 0 : true) && (Array.isArray(bizHours) ? bizHours.length > 0 : true)) {
      hasBizHoursCount++;
      if (sampleStoresWithBizHours.length < 5) {
        sampleStoresWithBizHours.push({ name, bizHours });
      }
    } else {
      emptyBizHoursCount++;
      if (sampleStoresWithoutBizHours.length < 5) {
        sampleStoresWithoutBizHours.push(name);
      }
    }
  }

  console.log('\n==================================================');
  console.log('📊 [전체 1,043개 가맹점 영업시간(businessHours) 수집 현황]');
  console.log('==================================================');
  console.log(`전체 가맹점 수: ${docs.length}개`);
  console.log(`영업시간 데이터가 있는 가맹점 수: ${hasBizHoursCount}개 (${((hasBizHoursCount / docs.length) * 100).toFixed(1)}%)`);
  console.log(`영업시간 데이터가 비어있는 가맹점 수: ${emptyBizHoursCount}개 (${((emptyBizHoursCount / docs.length) * 100).toFixed(1)}%)\n`);

  console.log('📌 [영업시간 데이터가 있는 샘플 5개]');
  sampleStoresWithBizHours.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name}`);
    console.log(`     └ businessHours: ${JSON.stringify(s.bizHours).slice(0, 100)}...`);
  });

  console.log('\n📌 [영업시간 데이터가 비어있는 샘플 5개]');
  sampleStoresWithoutBizHours.forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
}

checkAllStoresBizHoursStatus().catch(console.error);
