// 공공데이터포털(data.go.kr)의 "소상공인시장진흥공단_상가(상권)정보" API로 시군구 전체의 상가업소
// 데이터를 받아와서 그중 음식점만 Firestore에 시딩하는 스크립트.
//
// 왜 이게 필요한가:
// - scripts/seed-restaurants.ts(네이버 지역검색)는 검색어 하나당 최대 5건까지만 응답되고
//   페이지네이션이 없어서, 검색어를 아무리 잘게 쪼개도 특정 동네의 "모든" 음식점을 다 가져오는
//   건 원천적으로 불가능하다.
// - 이 API는 국세청/카드사 데이터 기반으로 시군구 전체 상가업소를 페이지당 최대 1000건씩,
//   페이지네이션으로 전부 받아올 수 있어서 훨씬 촘촘하게 커버할 수 있다.
//
// 사용법:
//   npm run seed:opendata -- ssg
//   npm run seed:opendata -- ssg --neighborhoods="영등포동1가,영등포동2가,영등포동3가,영등포동4가,영등포동5가,영등포동6가"
//     (이 실행에서만 임시로 필터할 법정동 목록을 지정 - company 문서의 neighborhoods 필드는 그대로 둠)
//
// 필요한 사전 준비:
// 1) data.go.kr에서 "소상공인시장진흥공단_상가(상권)정보" 서비스 신청 (승인까지 보통 1~2시간,
//    개발계정은 일 1,000건 트래픽 제공 - 이 스크립트는 시군구 하나당 몇~수십 건이면 끝나서 충분함)
// 2) .env.local에 DATA_GO_KR_SERVICE_KEY = "일반 인증키(Decoding)" 값 저장
// 3) npm run set:signgucd -- ssg 11560 로 company 문서에 시군구코드 저장 (서울 영등포구=11560 예시,
//    정확한 코드는 https://www.code.go.kr 법정동코드 조회에서 확인)
// 4) (선택) npm run set:neighborhoods -- ssg "영등포동1가,...,영등포동6가" 로 필터할 법정동 목록 저장
//    - neighborhoods를 안 저장해두면 시군구 전체(예: 영등포구 전체) 음식점을 다 가져온다(더 넓지만
//      그만큼 결과가 많고 회사에서 먼 곳도 섞임). 특정 동만 원하면 꼭 설정해두는 걸 권장.
//
// 응답 필드 관련 주의:
// - 이 API 응답 JSON의 정확한 필드명은 서비스 개편 시점에 따라 조금씩 달라질 수 있다고 알려져 있어서,
//   경도/위도 필드명을 lon/lat 우선으로 보되 x/y, xcoord/ycoord 등 알려진 대안도 방어적으로 같이
//   확인한다. 실행 후 콘솔에 찍히는 "[샘플]" 로그로 실제 필드명이 맞는지 꼭 확인할 것 - 다르면
//   아래 pickCoord 함수만 고치면 된다.
// - 업종 대분류명이 "음식"인 항목만 음식점으로 취급한다(카페/커피점도 이 대분류에 포함됨).

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const API_BASE = "http://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong";
const PAGE_SIZE = 1000;
const FOOD_LARGE_CATEGORY_NAME = "음식";

interface OpenDataStoreItem {
  bizesNm?: string; // 상호명
  brchNm?: string; // 지점명
  indsLclsNm?: string; // 상권업종대분류명 (예: "음식")
  indsMclsNm?: string; // 상권업종중분류명 (예: "한식", "커피점/카페")
  indsSclsNm?: string; // 상권업종소분류명
  ldongNm?: string; // 법정동명 (예: "영등포동4가")
  lnoAdr?: string; // 지번주소
  rdnmAdr?: string; // 도로명주소
  // 경도/위도 필드명이 API 버전에 따라 다를 수 있어 여러 후보를 optional로 받아둔다.
  lon?: string | number;
  lat?: string | number;
  x?: string | number;
  y?: string | number;
  xcoord?: string | number;
  ycoord?: string | number;
}

interface OpenDataResponse {
  header?: { resultCode?: string; resultMsg?: string };
  body?: {
    items?: OpenDataStoreItem[];
    totalCount?: number;
    numOfRows?: number;
    pageNo?: number;
  };
}

function pickCoord(item: OpenDataStoreItem): { lat: number; lng: number } {
  const lng = Number(item.lon ?? item.x ?? item.xcoord);
  const lat = Number(item.lat ?? item.y ?? item.ycoord);
  return { lat, lng };
}

async function fetchPage(signguCd: string, serviceKey: string, pageNo: number): Promise<OpenDataResponse> {
  const url =
    `${API_BASE}?divId=signguCd&key=${encodeURIComponent(signguCd)}` +
    `&serviceKey=${encodeURIComponent(serviceKey)}` +
    `&numOfRows=${PAGE_SIZE}&pageNo=${pageNo}&type=json`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`공공데이터포털 API 오류 (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as OpenDataResponse;
}

async function main() {
  const [companyCodeArg, ...rest] = process.argv.slice(2);
  if (!companyCodeArg) {
    console.error('사용법: npm run seed:opendata -- <companyCode> [--neighborhoods="동1,동2,..."]');
    process.exit(1);
  }

  const neighborhoodsArg = rest.find((arg) => arg.startsWith("--neighborhoods="));
  const neighborhoodsOverride = neighborhoodsArg
    ? neighborhoodsArg
        .slice("--neighborhoods=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) {
    console.error("DATA_GO_KR_SERVICE_KEY가 .env.local에 없습니다. 공공데이터포털에서 발급받은 값을 넣어줘.");
    process.exit(1);
  }

  const { getCompanyByCode } = await import("../src/lib/company-server");
  const { db } = await import("../src/lib/firebase");
  const { haversineMeters } = await import("../src/lib/geo");
  const { makeRestaurantId } = await import("../src/lib/restaurant-server");

  const company = await getCompanyByCode(companyCodeArg);
  if (!company) {
    console.error(`companies/${companyCodeArg} 문서를 찾을 수 없습니다. 회사코드를 확인해주세요.`);
    process.exit(1);
  }
  if (!company.signguCd) {
    console.error(
      `companies/${companyCodeArg}.signguCd가 없습니다. 먼저 npm run set:signgucd -- ${companyCodeArg} <5자리코드> 로 저장해줘.`
    );
    process.exit(1);
  }

  const neighborhoods = neighborhoodsOverride ?? company.neighborhoods ?? [];
  if (neighborhoods.length === 0) {
    console.log(
      "[참고] neighborhoods가 없어서 시군구 전체를 가져와요. 특정 동만 원하면 --neighborhoods=\"...\" 로 지정하거나 " +
        "npm run set:neighborhoods로 저장해줘."
    );
  }

  console.log(`[시딩 시작] company=${company.code} signguCd=${company.signguCd}`);

  // 1페이지를 먼저 받아서 totalCount를 확인하고, 그 뒤로 필요한 페이지 수만큼 이어서 받는다.
  const first = await fetchPage(company.signguCd, serviceKey, 1);
  if (first.header?.resultCode && first.header.resultCode !== "00") {
    console.error(`[API 오류] ${first.header.resultCode} ${first.header.resultMsg ?? ""}`);
    process.exit(1);
  }

  const totalCount = first.body?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  console.log(`[전체 ${totalCount}건, ${totalPages}페이지] 페이지당 최대 ${PAGE_SIZE}건씩 받아옵니다.`);

  const allItems: OpenDataStoreItem[] = [...(first.body?.items ?? [])];
  if (allItems.length > 0) {
    console.log("[샘플] 첫 항목 필드 확인:", JSON.stringify(allItems[0]).slice(0, 500));
  }

  for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
    const page = await fetchPage(company.signguCd, serviceKey, pageNo);
    allItems.push(...(page.body?.items ?? []));
    console.log(`  ...페이지 ${pageNo}/${totalPages} 완료 (누적 ${allItems.length}건)`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`[다운로드 완료] 시군구 전체 ${allItems.length}건`);

  const collected = new Map<
    string,
    { name: string; address: string; lat: number; lng: number; category: string | null; distanceMeters: number }
  >();

  let skippedNotFood = 0;
  let skippedWrongDong = 0;
  let skippedBadCoord = 0;

  for (const item of allItems) {
    if (item.indsLclsNm !== FOOD_LARGE_CATEGORY_NAME) {
      skippedNotFood += 1;
      continue;
    }
    if (neighborhoods.length > 0 && item.ldongNm && !neighborhoods.includes(item.ldongNm)) {
      skippedWrongDong += 1;
      continue;
    }

    const { lat, lng } = pickCoord(item);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      skippedBadCoord += 1;
      continue;
    }

    const name = [item.bizesNm, item.brchNm].filter(Boolean).join(" ").trim() || "이름없음";
    const address = item.rdnmAdr || item.lnoAdr || "";
    const category = item.indsMclsNm ?? item.indsSclsNm ?? null;
    const id = makeRestaurantId(name, address);
    const distanceMeters = haversineMeters(company.centerLat, company.centerLng, lat, lng);

    const existing = collected.get(id);
    if (existing && existing.distanceMeters <= distanceMeters) continue;

    collected.set(id, { name, address, lat, lng, category, distanceMeters: Math.round(distanceMeters) });
  }

  console.log(
    `[필터 완료] 음식점 대분류 아님 ${skippedNotFood}건 제외, 대상 동 아님 ${skippedWrongDong}건 제외, ` +
      `좌표 이상 ${skippedBadCoord}건 제외 → 최종 후보 ${collected.size}곳`
  );

  if (collected.size === 0) {
    console.log(
      "결과가 0곳이야. [샘플] 로그에 찍힌 필드명이 lon/lat/x/y/xcoord/ycoord 중 실제로 뭔지 확인해서 " +
        "이 스크립트의 pickCoord 함수를 맞게 고쳐야 할 수도 있어."
    );
    return;
  }

  const restaurantsRef = db.collection("companies").doc(company.code).collection("restaurants");

  // 이전에 이 스크립트(source:"opendata")로 넣은 항목만 지우고 다시 쓴다. 네이버 시딩(source:"seed")과
  // 직접 추가(source:"manual")는 건드리지 않는다.
  const previousDocs = await restaurantsRef.where("source", "==", "opendata").get();
  if (!previousDocs.empty) {
    const deleteBatch = db.batch();
    previousDocs.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
    console.log(`[cleanup] 이전 opendata 항목 ${previousDocs.size}건 삭제 (seed/manual 항목은 유지).`);
  }

  const batch = db.batch();
  for (const [id, restaurant] of collected) {
    batch.set(
      restaurantsRef.doc(id),
      {
        name: restaurant.name,
        address: restaurant.address,
        lat: restaurant.lat,
        lng: restaurant.lng,
        category: restaurant.category,
        isZeroPay: false,
        distanceMeters: restaurant.distanceMeters,
        source: "opendata",
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
