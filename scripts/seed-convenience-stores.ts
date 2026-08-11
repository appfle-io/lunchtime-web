import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const TARGET_NEIGHBORHOODS = [
  "영등포동1가",
  "영등포동2가",
  "영등포동3가",
  "영등포동4가",
  "영등포동5가",
  "영등포동6가",
  "영등포동7가",
  "영등포동8가",
  "당산동1가",
  "당산동2가",
  "문래동3가",
];

const CONVENIENCE_KEYWORDS = [
  "편의점",
  "GS25",
  "CU",
  "세븐일레븐",
  "이마트24",
  "미니스톱",
];

async function main() {
  const args = process.argv.slice(2);
  const companyCodeArg = args.find((a) => !a.startsWith("--")) || "ssg";

  const { getCompanyByCode } = await import("../src/lib/company-server");
  const { db } = await import("../src/lib/firebase");
  const { searchNaverLocal, stripHtmlTags, parseNaverCoords } = await import(
    "../src/lib/naver-local-search"
  );
  const { haversineMeters } = await import("../src/lib/geo");
  const { makeRestaurantId, invalidateRestaurantsCache, toRestaurantSummary } = await import("../src/lib/restaurant-server");
  const { enrichRestaurantById } = await import("../src/lib/enrich-server");

  const company = await getCompanyByCode(companyCodeArg);
  if (!company) {
    console.error(`companies/${companyCodeArg} 문서를 찾을 수 없습니다.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🏪 [6개 지역 편의점 일괄 수집 및 동기화 시작]`);
  console.log(`회사: ${company.name} (${company.code})`);
  console.log(`대상 지역 (${TARGET_NEIGHBORHOODS.length}개): ${TARGET_NEIGHBORHOODS.join(", ")}`);
  console.log(`==================================================\n`);

  const restaurantsRef = db.collection("companies").doc(company.code).collection("restaurants");
  const candidates = new Map<string, { id: string; name: string; address: string; lat: number; lng: number; category: string }>();

  // 1. 네이버 지역검색으로 6개 동 x 브랜드별 탐색
  for (const dong of TARGET_NEIGHBORHOODS) {
    for (const brand of CONVENIENCE_KEYWORDS) {
      const query = `${dong} ${brand}`;
      try {
        const items = await searchNaverLocal(query, 5);
        for (const item of items) {
          const title = stripHtmlTags(item.title);
          const address = item.roadAddress || item.address;
          const { lat, lng } = parseNaverCoords(item);

          if (!title || !address || Number.isNaN(lat) || Number.isNaN(lng)) continue;

          const id = makeRestaurantId(title, address);
          if (!candidates.has(id)) {
            candidates.set(id, {
              id,
              name: title,
              address,
              lat,
              lng,
              category: item.category ? stripHtmlTags(item.category) : "생활,편의>편의점",
            });
          }
        }
      } catch (err) {
        console.warn(`  ⚠️ 검색 실패: "${query}" -> ${(err as Error).message}`);
      }
      // Rate limiting 방지
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`🔍 총 ${candidates.size}개의 유일한 편의점을 수집했습니다. DB 시딩 및 정보 융합을 시작합니다...\n`);

  let newCount = 0;
  let updatedCount = 0;

  // 기존 식당 목록 읽기 (중복 매칭용)
  const existingSnap = await restaurantsRef.get();
  const existingDocs = existingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  for (const candidate of candidates.values()) {
    // 1. naverPlaceId 또는 이름+주소로 기존 수기/시딩 문서 탐색
    let targetDoc = existingDocs.find(
      (e) => e.id === candidate.id || (e.name === candidate.name && e.address === candidate.address)
    );

    const docId = targetDoc ? targetDoc.id : candidate.id;
    const docRef = restaurantsRef.doc(docId);

    const distanceMeters = Math.round(
      haversineMeters(company.centerLat, company.centerLng, candidate.lat, candidate.lng)
    );

    const baseData: Record<string, any> = {
      name: candidate.name,
      address: candidate.address,
      lat: candidate.lat,
      lng: candidate.lng,
      category: candidate.category,
      categoryLabel: "편의점",
      distanceMeters,
      isActive: true,
      updatedAt: new Date().toISOString(),
    };

    if (!targetDoc) {
      newCount++;
      baseData.source = "seed_convenience";
      baseData.isZeroPay = false;
      baseData.addedAt = new Date().toISOString();
      await docRef.set(baseData);
      console.log(`  [신규 추가] ${candidate.name} (${candidate.address})`);
    } else {
      updatedCount++;
      // 수기(manual) 입력 문서인 경우 source 필드를 유지
      if (targetDoc.source === "manual") {
        delete baseData.source;
      }
      await docRef.set(baseData, { merge: true });
      console.log(`  [기존 문서 병합/갱신] ${candidate.name} (ID: ${docId})`);
    }

    // 네이버맵 상세 수집 (phone, placeUrl 등 - 회사 방화벽 지연 방지를 위해 skipZeroPay: true)
    try {
      const enrichRes = await enrichRestaurantById(company.code, docId, { skipZeroPay: true });
      const fields = enrichRes.enrichedFields;
      console.log(
        `     └ 🔄 수집완료: Place ID (${fields.naverPlaceId ?? "N/A"}), 전화 (${fields.phone ?? "N/A"}), 제로페이 (${fields.isZeroPay ? "✅ YES" : "❌ NO"})`
      );
    } catch (enrichErr) {
      console.warn(`     └ ⚠️ 수집 실패: ${(enrichErr as Error).message}`);
    }
  }

  invalidateRestaurantsCache(company.code);

  console.log(`\n==================================================`);
  console.log(`🎉 [편의점 수집 완료 리포트]`);
  console.log(`  - 총 탐색된 편의점: ${candidates.size}개`);
  console.log(`  - 신규 생성된 문식: ${newCount}개`);
  console.log(`  - 기존 데이터 갱신: ${updatedCount}개`);
  console.log(`==================================================\n`);
}

main().catch(console.error);
