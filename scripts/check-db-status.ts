import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkDbState() {
  const { db } = await import('../src/lib/firebase');
  const snap = await db.collection('companies').doc('ssg').collection('restaurants').get();
  
  let trueCount = 0;
  let falseCount = 0;

  console.log('=== 상위 10개 매장 실시간 Firestore 데이터 ===');
  snap.docs.slice(0, 10).forEach(d => {
    console.log(`[${d.id}] ${d.data().name} | isZeroPay: ${d.data().isZeroPay} (${typeof d.data().isZeroPay})`);
  });

  snap.docs.forEach(d => {
    if (d.data().isZeroPay === true) {
      trueCount++;
    } else {
      falseCount++;
    }
  });
  
  console.log(`\n=== 최종 실시간 Firestore DB 검증 ===`);
  console.log(`총 매장 문서 수: ${snap.size}개`);
  console.log(`🟢 isZeroPay == true (제로페이 가맹점): ${trueCount}개`);
  console.log(`🔴 isZeroPay == false (미가맹점): ${falseCount}개`);
  process.exit(0);
}

checkDbState().catch(console.error);
