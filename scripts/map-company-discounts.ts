import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

interface DiscountRecord {
  name: string;
  benefit: string | null;
  note: string | null;
}

const DISCOUNT_RECORDS: DiscountRecord[] = [
  // 타임스퀘어
  { name: "무월식당", benefit: "10%", note: null },
  { name: "강가", benefit: null, note: "세트 및 주류 제외" },
  { name: "신차이", benefit: null, note: "세트 및 주류 제외" },
  { name: "한일관", benefit: null, note: null },
  { name: "을지깐깐", benefit: null, note: "세트 제외" },
  { name: "용호낙지", benefit: null, note: "주중 11시~16시 & 주류, 음료, 사이드 제외" },
  { name: "콘타이", benefit: null, note: "주중 11시~15시 & 주류, 음료, 사이드 제외 (분할결제X)" },
  { name: "송송카츠", benefit: null, note: "주중 11시~15시 & 주류, 음료, 사이드 제외 (분할결제X)" },
  { name: "돈부리파스타", benefit: null, note: "주중 11시~16시" },
  { name: "마마된장", benefit: null, note: "게살, 새우장류 제외" },
  { name: "남도분식", benefit: null, note: "11시~16시 (분할결제X)" },
  { name: "띤띤", benefit: null, note: "11시~17시 (분할결제X)" },
  { name: "마라로", benefit: "제휴 할인", note: null },
  { name: "온더보더", benefit: null, note: "런치세트 메뉴 제외, 알코올 쿠폰 중복할인 불가" },
  { name: "아비꼬", benefit: null, note: "11시~15시, 세트 메뉴 및 프로모션 메뉴 제외 (분할결제X)" },
  { name: "호우섬", benefit: null, note: "세트 메뉴 및 프로모션 중복 할인 불가" },
  { name: "고부대", benefit: null, note: "W컨셉, SSG닷컴 직원만 할인" },
  { name: "쿠차라", benefit: null, note: "병음료, 주류 제외" },
  { name: "홍수계찜닭", benefit: null, note: "주중 11시~15시, 한상 메뉴 제외" },
  { name: "카오소이", benefit: null, note: "주중 11시~16시 & 주류, 음료, 사이드 제외 (분할결제X)" },
  { name: "온기정", benefit: null, note: "11시~16시, 세트 메뉴 및 프로모션 메뉴 제외" },
  { name: "더플레이스", benefit: "20%", note: "세트 메뉴 및 프로모션 중복 할인 불가" },
  { name: "겐로쿠우동", benefit: "서비스", note: "1인 1메뉴 주문시 이나리(유부초밥) 1개" },
  { name: "샤브촌 By 계백집", benefit: "서비스", note: "사이드 1회 무료 (물만두, 죽, 칼국수, 음료 중 택1)" },
  { name: "차알", benefit: "전 메뉴 10%", note: "주중, 주말 상시 (17시 이후 주류 1+1, 맥주 제외)" },
  { name: "쉐이크쉑", benefit: "서비스", note: "탄산 S 1잔 무료 (버거 구매시)" },
  { name: "백미당", benefit: "5~10%", note: "커피 5종 할인" },
  { name: "베스킨라빈스", benefit: "10%", note: "무인기 현금결제 처리후 -> 사원증 제시 (카드결제)" },
  { name: "스트릿츄러스", benefit: "1천원", note: "아메리카노, 라떼 할인" },
  { name: "콜렉티보 케이크샵", benefit: "음료 할인", note: "제조 음료 50% 할인" },

  // 신세계백화점 타임스퀘어점
  { name: "하프커피", benefit: "음료 할인", note: "사원증 제시시 20% 할인 + 백화점 F&B 할인 추가 10% 적용 가능" },

  // 인근 카페 제휴
  { name: "루루도넛", benefit: "10% 할인", note: "전 메뉴" },
  { name: "와이스퀘어커피", benefit: "10% 할인", note: "전 메뉴" },
  { name: "뱀부그로브커피", benefit: "15% 할인", note: "핸드드립, 디저트 제외 (적립 불가)" },
];

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

async function main() {
  const companyCode = process.argv[2] || "ssg";

  const { db } = await import("../src/lib/firebase");
  const { invalidateRestaurantsCache } = await import("../src/lib/restaurant-server");

  console.log(`\n==================================================`);
  console.log(`🏷️ [제휴 할인 정보 데이터베이스 맵핑 시작] (회사: ${companyCode})`);
  console.log(`==================================================\n`);

  const restaurantsRef = db.collection("companies").doc(companyCode).collection("restaurants");
  const snap = await restaurantsRef.get();
  const existingDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  console.log(`현재 등록된 가맹점 수: ${existingDocs.length}개\n`);

  const mapped: Array<{ recordName: string; matchedName: string; docId: string; address: string; benefit: string; note: string }> = [];
  const unmapped: Array<{ recordName: string; reason: string }> = [];

  for (const rec of DISCOUNT_RECORDS) {
    const recNorm = normalize(rec.name);

    // 1. 이름 완전일치 또는 매칭 탐색
    let matches = existingDocs.filter((d) => {
      const dNorm = normalize(d.name ?? "");
      return dNorm === recNorm || dNorm.includes(recNorm) || recNorm.includes(dNorm);
    });

    // 특수 매칭 방어 (무월식당 -> 무월식탁, 샤브촌 By 계백집 -> 계백집 / 샤브촌)
    if (matches.length === 0 && rec.name.includes("무월식당")) {
      matches = existingDocs.filter((d) => normalize(d.name ?? "").includes("무월식탁"));
    }
    if (matches.length === 0 && rec.name.includes("계백집")) {
      matches = existingDocs.filter((d) => normalize(d.name ?? "").includes("계백집"));
    }
    if (matches.length === 0 && rec.name.includes("콜렉티보")) {
      matches = existingDocs.filter((d) => normalize(d.name ?? "").includes("콜렉티보"));
    }
    if (matches.length === 0 && rec.name.includes("베스킨")) {
      matches = existingDocs.filter((d) => normalize(d.name ?? "").includes("배스킨") || normalize(d.name ?? "").includes("베스킨"));
    }

    if (matches.length === 0) {
      unmapped.push({ recordName: rec.name, reason: "DB에서 해당 가맹점을 찾을 수 없음" });
      continue;
    }

    // 여러 건 매칭 시 타임스퀘어/영등포 인근 매장 우선
    let target = matches[0];
    if (matches.length > 1) {
      const tsMatch = matches.find((m) => (m.address ?? "").includes("영중로") || (m.address ?? "").includes("타임스퀘어"));
      if (tsMatch) target = tsMatch;
    }

    // 혜택 / 비고 대입
    const benefitVal = rec.benefit || (rec.note ? "제휴 할인" : "제휴 할인");
    const noteVal = rec.note || "";

    const discountInfo = {
      benefit: benefitVal,
      note: noteVal || null,
    };

    await restaurantsRef.doc(target.id).set(
      {
        discountInfo,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    mapped.push({
      recordName: rec.name,
      matchedName: target.name,
      docId: target.id,
      address: target.address ?? "",
      benefit: benefitVal,
      note: noteVal,
    });
  }

  invalidateRestaurantsCache(companyCode);

  console.log(`==================================================`);
  console.log(`🎉 [제휴 할인 맵핑 결과 종합 리포트]`);
  console.log(`  - 총 제휴 목록 건수: ${DISCOUNT_RECORDS.length}개`);
  console.log(`  - ✅ 성공적으로 맵핑된 가맹점: ${mapped.length}개`);
  console.log(`  - ❌ 미맵핑된 가맹점: ${unmapped.length}개`);
  console.log(`==================================================\n`);

  console.log(`✅ [맵핑 성공 가맹점 목록 (${mapped.length}개)]`);
  mapped.forEach((m, idx) => {
    console.log(`${idx + 1}. [${m.recordName}] → DB명: "${m.matchedName}" (ID: ${m.docId})`);
    console.log(`   주소: ${m.address}`);
    console.log(`   혜택: ${m.benefit} | 비고: ${m.note || "(없음)"}`);
  });

  if (unmapped.length > 0) {
    console.log(`\n❌ [미맵핑 가맹점 목록 (${unmapped.length}개)]`);
    unmapped.forEach((u, idx) => {
      console.log(`${idx + 1}. [${u.recordName}] - 사유: ${u.reason}`);
    });
  }
}

main().catch(console.error);
