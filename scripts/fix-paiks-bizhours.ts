import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { db } = await import('../src/lib/firebase');
  const restaurantsRef = db.collection('companies').doc('ssg').collection('restaurants');

  const bizHoursText = [
    '월 07:30 - 20:30',
    '화 07:30 - 20:30',
    '수 07:30 - 20:30',
    '목 07:30 - 20:30',
    '금 07:30 - 20:30',
    '토 07:30 - 20:30',
    '일 07:30 - 20:00',
    '- 19시 아이스크림 마감'
  ].join('\n');

  await restaurantsRef.doc('a196486faa72464c').update({
    businessHours: bizHoursText
  });

  console.log('✅ 빽다방 영등포시장사거리점 영업시간 DB 커밋 완료!');
  console.log(bizHoursText);
}

main().catch(console.error);
