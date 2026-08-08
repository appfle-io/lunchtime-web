import { checkZeroPayOfficial } from '../src/lib/zeropay-official';

async function testAddressMatching() {
  const tests = [
    { name: '영등포역', addr: '서울특별시 영등포구 경인로 846' },
    { name: '하루국시101 영등포점', addr: '서울특별시 영등포구 영등포로 197-1' },
    { name: '밥프로밥pro', addr: '서울특별시 영등포구 경인로 775' },
    { name: '왓더버거 영등포점', addr: '서울특별시 영등포구 영등포로 149' }
  ];

  console.log('=== Address Matching Validation Test ===\n');

  for (const t of tests) {
    const res = await checkZeroPayOfficial(t.name, t.addr);
    console.log(`Target: "${t.name}" | DB Address: "${t.addr}"`);
    console.log(` -> Status: ${res.isZeroPay ? '🟢 ZeroPay Approved' : '🔴 Address Mismatch / Not ZeroPay'}`);
    if (res.isZeroPay) {
      console.log(`    Official Name: ${res.officialName} | Official Address: ${res.officialAddress}`);
    }
    console.log('');
  }
  process.exit(0);
}

testAddressMatching().catch(console.error);
