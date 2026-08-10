import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function updateAllNaverUrls() {
  const { db } = await import('../src/lib/firebase');
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();
  
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');
  const WRITE_BATCH = 400;

  const validDocs = snap.docs.filter(d => d.data().naverPlaceId);
  console.log(`\n🚀 [네이버 맵 최신 공식 URL 일괄 마이그레이션] 총 ${validDocs.length}개 식당 시작\n`);

  let updatedCount = 0;

  for (let i = 0; i < validDocs.length; i += WRITE_BATCH) {
    const batch = db.batch();
    const chunk = validDocs.slice(i, i + WRITE_BATCH);
    
    for (const doc of chunk) {
      const pid = doc.data().naverPlaceId;
      const officialUrl = `https://map.naver.com/p/entry/place/${pid}`;
      batch.update(restaurantsRef.doc(doc.id), {
        naverPlaceUrl: officialUrl,
        naverUrlUpdatedAt: new Date().toISOString(),
      });
      updatedCount++;
    }

    await batch.commit();
    console.log(`  ... [${Math.min(i + WRITE_BATCH, validDocs.length)}/${validDocs.length}] DB 커밋 완료`);
  }

  console.log(`\n🎉 [완료] 총 ${updatedCount}개 식당의 naverPlaceUrl 링크가 최신 공식 규격(https://map.naver.com/p/entry/place/{id})으로 100% 일괄 교체되었습니다!`);
  process.exit(0);
}

updateAllNaverUrls().catch(err => { console.error('[실패]', err); process.exit(1); });
