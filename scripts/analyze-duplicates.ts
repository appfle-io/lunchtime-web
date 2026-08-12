import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { db } = await import('../src/lib/firebase');

  const companiesSnap = await db.collection('companies').get();
  console.log(`[INFO] 총 회사 수: ${companiesSnap.size}`);

  for (const companyDoc of companiesSnap.docs) {
    const companyId = companyDoc.id;
    console.log(`\n========================================`);
    console.log(`회사 ID: ${companyId}`);

    const storesSnap = await db.collection('companies').doc(companyId).collection('restaurants').get();
    console.log(`가맹점 총 개수: ${storesSnap.size}`);

    const stores = storesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 1. DETOXI 검색
    const detoxiStores = stores.filter((s: any) => 
      (s.name && s.name.toUpperCase().includes('DETOXI')) ||
      (s.name && s.name.includes('디톡시'))
    );
    console.log(`\n--- DETOXI 매장 목록 (${detoxiStores.length}개) ---`);
    for (const d of detoxiStores) {
      console.log(JSON.stringify(d, null, 2));
    }

    // 2. 전체 매장 중 이름/주소/전화번호 기반 중복 탐지
    const nameMap = new Map<string, any[]>();
    const normNameMap = new Map<string, any[]>();
    const addrMap = new Map<string, any[]>();
    const phoneMap = new Map<string, any[]>();
    const naverUrlMap = new Map<string, any[]>();

    for (const s of stores as any[]) {
      const name = (s.name || '').trim();
      const normName = name.replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
      const addr = (s.address || '').trim();
      const phone = (s.phone || '').replace(/[^0-9]/g, '');
      const naverUrl = (s.naverPlaceUrl || '').trim();

      if (name) {
        if (!nameMap.has(name)) nameMap.set(name, []);
        nameMap.get(name)!.push(s);
      }
      if (normName) {
        if (!normNameMap.has(normName)) normNameMap.set(normName, []);
        normNameMap.get(normName)!.push(s);
      }
      if (addr && addr.length > 5) {
        if (!addrMap.has(addr)) addrMap.set(addr, []);
        addrMap.get(addr)!.push(s);
      }
      if (phone && phone.length >= 7) {
        if (!phoneMap.has(phone)) phoneMap.set(phone, []);
        phoneMap.get(phone)!.push(s);
      }
      if (naverUrl) {
        if (!naverUrlMap.has(naverUrl)) naverUrlMap.set(naverUrl, []);
        naverUrlMap.get(naverUrl)!.push(s);
      }
    }

    console.log(`\n========================================`);
    console.log(`[1] 완전 동일 상호명 중복 그룹`);
    for (const [name, group] of nameMap.entries()) {
      if (group.length > 1) {
        console.log(`\n📍 상호명: "${name}" (${group.length}개 등록)`);
        for (const item of group) {
          console.log(`   - ID: ${item.id} | 이름: "${item.name}" | 주소: "${item.address}" | 전화: "${item.phone || '없음'}" | 소스: "${item.source || '미지정'}" | isHidden: ${item.isHidden} | disabled: ${item.disabled} | isZeroPay: ${item.isZeroPay}`);
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`[2] 정규화 상호명 동일 (공백/특수문자 무시 - 완전동일 상호명 제외)`);
    for (const [normName, group] of normNameMap.entries()) {
      if (group.length > 1) {
        const distinctNames = new Set(group.map(g => g.name.trim()));
        if (distinctNames.size > 1) {
          console.log(`\n📍 정규화 상호: "${normName}" (${group.length}개 등록)`);
          for (const item of group) {
            console.log(`   - ID: ${item.id} | 원본이름: "${item.name}" | 주소: "${item.address}" | 전화: "${item.phone || '없음'}" | 소스: "${item.source || '미지정'}" | isHidden: ${item.isHidden} | disabled: ${item.disabled}`);
          }
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`[3] 네이버 지도 URL 동일 중복 그룹`);
    for (const [url, group] of naverUrlMap.entries()) {
      if (group.length > 1) {
        console.log(`\n📍 Naver URL: "${url}" (${group.length}개 등록)`);
        for (const item of group) {
          console.log(`   - ID: ${item.id} | 이름: "${item.name}" | 주소: "${item.address}" | 소스: "${item.source || '미지정'}" | isHidden: ${item.isHidden}`);
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`[4] 동일 주소 중복 그룹 (상호명 차이 존재 포함)`);
    for (const [addr, group] of addrMap.entries()) {
      if (group.length > 1) {
        const distinctNames = new Set(group.map(g => g.name.trim()));
        if (distinctNames.size > 1) {
          console.log(`\n📍 주소: "${addr}" (${group.length}개 등록)`);
          for (const item of group) {
            console.log(`   - ID: ${item.id} | 이름: "${item.name}" | 소스: "${item.source || '미지정'}" | isHidden: ${item.isHidden}`);
          }
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`[5] 동일 전화번호 중복 그룹 (상호명 차이 존재 포함)`);
    for (const [phone, group] of phoneMap.entries()) {
      if (group.length > 1) {
        const distinctNames = new Set(group.map(g => g.name.trim()));
        if (distinctNames.size > 1) {
          console.log(`\n📍 전화번호: "${phone}" (${group.length}개 등록)`);
          for (const item of group) {
            console.log(`   - ID: ${item.id} | 이름: "${item.name}" | 주소: "${item.address}" | 소스: "${item.source || '미지정'}" | isHidden: ${item.isHidden}`);
          }
        }
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
