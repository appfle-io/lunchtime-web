// 회사 반경 내 식당을 네이버 지역검색 API(NAVER API Hub)로 모아서 Firestore에 시딩하는 스크립트.
//
// 사용법:
//   npm run seed:restaurants -- ssg
//   npm run seed:restaurants -- ssg --radius=1000   (기본 반경 1500m)
//   npm run seed:restaurants -- ssg --neighborhoods="영등포동1가,영등포동2가,영등포동3가,영등포동4가,영등포동5가,영등포동6가"
//     (이 실행에서만 임시로 동 목록을 지정 - company 문서의 neighborhoods 필드는 건드리지 않음.
//      매번 다시 입력하지 않고 계속 쓰고 싶으면 scripts/set-company-neighborhoods.ts로 회사
//      문서에 영구 저장해두는 걸 권장.)
//
// 필요한 .env.local 값: NAVER_SEARCH_CLIENT_ID, NAVER_SEARCH_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT_KEY
//
// 검색 앵커 3가지를 조합해서 씀:
// 1) districtCode(구/동 단위) + 음식 카테고리 키워드  - 구 전체를 넓게 훑기
// 2) landmarks(자주 가는 장소, 예: "영등포타임스퀘어") 단독 검색  - 특정 건물 안/근처 식당을 정확히 잡기
// 3) neighborhoods(행정동 이름, 예: "영등포동1가") + 카테고리 키워드  - 동 단위로 촘촘하게 훑기
//    (2026-08-06 신규: "영등포동1가~6가 음식점이 너무 많이 빠진다"는 피드백으로 추가. district
//    검색 하나("영등포구 한식")로는 구 전체가 넓어서 특정 동의 가게들이 상위 5건 안에 아예 안 들어오는
//    경우가 많았다 - 검색어를 동 이름 단위로 쪼개서 후보 풀 자체를 넓히는 접근.)
//
// 알아둘 점 (현재 구현의 한계):
// - 네이버 지역검색 API는 좌표 기반 반경 검색이 아니라 텍스트 검색이라, 회사 중심좌표와의 거리를 직접 계산해서
//   radius 밖은 걸러내는 방식으로 구현했다.
// - 한 키워드당 최대 5개까지만 응답되고 페이지네이션이 없다 (네이버 지역검색 API 자체 제약).
//   -> 이 한계 때문에 검색어 자체를 최대한 잘게 쪼개는(동 이름 + 카테고리 조합 등) 것 외에는
//      한 번의 API 호출로 "그 동네 음식점 전체"를 통째로 가져올 방법이 없다. 그래도 빠지는 곳은
//      companies/{code}/restaurants에 "직접 추가" 기능(POST /api/restaurants)으로 채워나간다.
// - 제로페이 가맹점 여부(isZeroPay)는 이 스크립트에서는 판단하지 않고 기본값 false로 넣는다.
//   추후 공공데이터 매칭 파이프라인/사내 투표 기능으로 별도 보정 예정 (기획 문서 참고).

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CATEGORY_KEYWORDS = [
  "한식",
  "중식",
  "일식",
  "분식",
  "카페",
  "고기",
  "국수",
  "샐러드",
  "도시락",
  "치킨",
  "베이커리",
  "국밥",
];

const DEFAULT_RADIUS_METERS = 1500;

async function main() {
  const [companyCodeArg, ...rest] = process.argv.slice(2);
  if (!companyCodeArg) {
    console.error(
      '사용법: npm run seed:restaurants -- <companyCode> [--radius=1500] [--neighborhoods="동1,동2,..."]'
    );
    process.exit(1);
  }

  const radiusArg = rest.find((arg) => arg.startsWith("--radius="));
  const radiusMeters = radiusArg ? Number(radiusArg.split("=")[1]) : DEFAULT_RADIUS_METERS;

  const neighborhoodsArg = rest.find((arg) => arg.startsWith("--neighborhoods="));
  const neighborhoodsOverride = neighborhoodsArg
    ? neighborhoodsArg
        .slice("--neighborhoods=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  // dotenv.config()가 먼저 실행된 뒤에 firebase-admin을 초기화하는 lib/firebase.ts를 import해야
  // 서비스 계정 키를 정상적으로 읽는다. (정적 import는 파일 맨 위로 끌어올려지므로 동적 import 사용)
  const { getCompanyByCode } = await import("../src/lib/company-server");
  const { db } = await import("../src/lib/firebase");
  const { searchNaverLocal, stripHtmlTags, parseNaverCoords } = await import(
    "../src/lib/naver-local-search"
  );
  const { haversineMeters } = await import("../src/lib/geo");
  const { makeRestaurantId } = await import("../src/lib/restaurant-server");
  const { isFoodRelatedCategory } = await import("../src/lib/restaurant-category");

  const company = await getCompanyByCode(companyCodeArg);
  if (!company) {
    console.error(`companies/${companyCodeArg} 문서를 찾을 수 없습니다. 회사코드를 확인해주세요.`);
    process.exit(1);
  }

  if (typeof company.centerLat !== "number" || typeof company.centerLng !== "number") {
    console.error(
      `companies/${companyCodeArg}의 centerLat/centerLng가 숫자가 아닙니다. Firestore 콘솔에서 타입을 확인해주세요.`
    );
    process.exit(1);
  }

  console.log(
    `[시딩 시작] company=${company.code} center=(${company.centerLat}, ${company.centerLng}) radius=${radiusMeters}m`
  );

  const anchor = company.districtCode ?? "";
  const neighborhoods = neighborhoodsOverride ?? company.neighborhoods ?? [];

  // district 단위 카테고리 검색: "영등포구 중식"처럼 구 전체를 훑는 넓은 검색이라, 결과가
  // 회사에서 먼 곳일 수도 있어서 아래 radius 필터를 반드시 적용한다.
  const districtQueries: string[] = CATEGORY_KEYWORDS.map((keyword) => `${anchor} ${keyword}`.trim());

  // landmark(자주 가는 장소) 검색: landmark 자체가 이미 "회사 근처에서 자주 언급되는 곳"이라는
  // 신호라서 radius 필터를 적용하지 않는다.
  const landmarkQueries: string[] = [];
  for (const landmark of company.landmarks ?? []) {
    landmarkQueries.push(landmark);
    landmarkQueries.push(`${landmark} 맛집`);
    landmarkQueries.push(`${landmark} 카페`);
    landmarkQueries.push(`${landmark} 푸드코트`);
    for (const keyword of CATEGORY_KEYWORDS) {
      landmarkQueries.push(`${landmark} ${keyword}`);
    }
  }

  // neighborhood(행정동 이름) 검색: "영등포동1가"처럼 동 이름 자체가 이미 정확한 지역 범위라서,
  // landmark와 마찬가지로 radius 필터를 적용하지 않는다. 동 이름 단독 + "맛집"/"음식점" +
  // 카테고리별 조합까지 만들어서, district 검색 하나로는 안 걸리던(구 전체 대비 상위 5건 밖으로
  // 밀려나던) 그 동네 안의 가게들을 최대한 넓게 잡아낸다.
  const neighborhoodQueries: string[] = [];
  for (const neighborhood of neighborhoods) {
    neighborhoodQueries.push(neighborhood);
    neighborhoodQueries.push(`${neighborhood} 맛집`);
    neighborhoodQueries.push(`${neighborhood} 음식점`);
    for (const keyword of CATEGORY_KEYWORDS) {
      neighborhoodQueries.push(`${neighborhood} ${keyword}`);
    }
  }

  const queries: { text: string; applyRadiusFilter: boolean }[] = [
    ...districtQueries.map((text) => ({ text, applyRadiusFilter: true })),
    ...landmarkQueries.map((text) => ({ text, applyRadiusFilter: false })),
    ...neighborhoodQueries.map((text) => ({ text, applyRadiusFilter: false })),
  ];

  console.log(
    `[검색어 준비] district 검색 ${districtQueries.length}개 + landmark 검색 ${landmarkQueries.length}개 + ` +
      `neighborhood 검색 ${neighborhoodQueries.length}개(${neighborhoods.length}개 동) = 총 ${queries.length}개`
  );
  if (neighborhoods.length === 0) {
    console.log(
      '  [참고] neighborhoods가 비어있어서 동 단위 검색은 건너뜀. ' +
        '--neighborhoods="동1,동2,..." 옵션이나 scripts/set-company-neighborhoods.ts로 동 목록을 지정해줘.'
    );
  }

  const collected = new Map<
    string,
    {
      name: string;
      address: string;
      lat: number;
      lng: number;
      category: string | null;
      distanceMeters: number;
    }
  >();

  let queryIndex = 0;
  for (const { text: query, applyRadiusFilter } of queries) {
    queryIndex += 1;
    if (queryIndex % 20 === 0) {
      console.log(`  ...진행 중 (${queryIndex}/${queries.length}), 지금까지 ${collected.size}곳 수집`);
    }

    let items;
    try {
      items = await searchNaverLocal(query, 5);
    } catch (err) {
      console.warn(`  [경고] "${query}" 검색 실패: ${(err as Error).message}`);
      continue;
    }

    for (const item of items) {
      const { lat, lng } = parseNaverCoords(item);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const category = item.category ? stripHtmlTags(item.category) : null;
      if (!isFoodRelatedCategory(category)) continue;

      const distanceMeters = haversineMeters(company.centerLat, company.centerLng, lat, lng);
      if (applyRadiusFilter && distanceMeters > radiusMeters) continue;

      const name = stripHtmlTags(item.title);
      const address = item.roadAddress || item.address;
      const id = makeRestaurantId(name, address);

      // 이미 다른 검색어에서 잡힌 식당이면 더 가까운 거리로만 갱신 (중복 방지).
      const existing = collected.get(id);
      if (existing && existing.distanceMeters <= distanceMeters) continue;

      collected.set(id, {
        name,
        address,
        lat,
        lng,
        category,
        distanceMeters: Math.round(distanceMeters),
      });
    }

    // API에 너무 빠르게 연달아 치지 않도록 살짝 쉬어감 (필수는 아니지만 매너상).
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`[검색 완료] 반경 ${radiusMeters}m 내 후보 ${collected.size}곳`);

  if (collected.size === 0) {
    console.log(
      "결과가 0곳이야. districtCode/landmarks/neighborhoods가 회사 근처를 잘 못 잡는 걸 수도 있어. " +
        "company 문서의 districtCode를 더 좁은 동네 이름으로 바꾸거나 landmarks/neighborhoods를 추가해서 다시 시도해봐."
    );
    return;
  }

  const batch = db.batch();
  const restaurantsRef = db.collection("companies").doc(company.code).collection("restaurants");

  // Delete previously seeded restaurants (source:"seed") before writing the fresh set.
  // Manually-added restaurants (source:"manual") are excluded from this cleanup,
  // so re-running the seed script won't wipe anything a user added by hand.
  const previousSeedDocs = await restaurantsRef.where("source", "==", "seed").get();
  if (!previousSeedDocs.empty) {
    const deleteBatch = db.batch();
    previousSeedDocs.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
    console.log(`[cleanup] Deleted ${previousSeedDocs.size} previous seed entries (manual entries kept).`);
  }

  for (const [id, restaurant] of collected) {
    batch.set(
      restaurantsRef.doc(id),
      {
        name: restaurant.name,
        address: restaurant.address,
        lat: restaurant.lat,
        lng: restaurant.lng,
        category: restaurant.category,
        isZeroPay: false, // TODO: 제로페이 공공데이터 매칭 파이프라인으로 추후 갱신
        distanceMeters: restaurant.distanceMeters,
        source: "seed",
        seededAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`[Firestore 저장 완료] companies/${company.code}/restaurants 에 ${collected.size}건 저장됨.`);
}

main().catch((err) => {
  console.error("[시딩 실패]", err);
  process.exit(1);
});
