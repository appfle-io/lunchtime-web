// 공공데이터포털에서 미리 내려받은 "소상공인시장진흥공단_상가(상권)정보" CSV 파일을 읽어서
// 음식점만 골라 Firestore에 추가하는 스크립트. API를 직접 호출하지 않고(인증키 신청/승인 대기가
// 필요 없음) 이미 가진 CSV 파일 하나로 처리한다.
//
// *** 이 스크립트는 "이미 있는 건 건너뛰고 없는 것만 추가"하는 방식이다 (upsert가 아니라 insert-if-missing) ***
// - 처음 실행할 때 대량으로 밀어넣고, 그 다음부터는 재실행해도 이미 저장된 식당은 절대 건드리지
//   않는다(제로페이 투표 결과 등 그 사이 쌓인 데이터를 보존하기 위함). 순수 신규 항목만 추가된다.
// - 기존 seed-restaurants.ts/seed-restaurants-opendata.ts처럼 "이전 항목을 지우고 다시 쓰는" 방식이
//   아니므로, 여러 CSV(다른 시점에 받은 파일)를 여러 번 돌려도 안전하다.
//
// 사용법:
//   1) data.go.kr에서 내려받은 CSV를 프로젝트의 data/ 폴더에 둔다 (예:
//      data/상가업소_서울.csv). data/*.csv는 .gitignore에 이미 추가돼 있어서 git에는 안 올라간다.
//   2) npm run seed:csv -- ssg data/상가업소_서울.csv
//      npm run seed:csv -- ssg data/상가업소_서울.csv --neighborhoods="영등포동1가,영등포동2가,영등포동3가,영등포동4가,영등포동5가,영등포동6가"
//      (neighborhoods를 안 주면 company 문서의 neighborhoods 필드를 쓰고, 그것도 없으면 시군구
//      전체 - company.signguCd 또는 districtCode로 매칭 - 음식점을 전부 대상으로 한다.)
//
// CSV 컬럼(직접 열어서 확인한 실제 헤더 기준): 상가업소번호, 상호명, 지점명, 상권업종대분류코드,
// 상권업종대분류명, 상권업종중분류코드, 상권업종중분류명, ..., 시군구코드, 시군구명, 행정동코드,
// 행정동명, 법정동코드, 법정동명, ..., 지번주소, ..., 도로명주소, ..., 경도, 위도
// (경도/위도는 네이버 지역검색의 mapx/mapy와 달리 이미 실제 도(degree) 단위 소수라 별도 스케일
// 변환이 필요 없다.)
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY (Firestore 쓰기용, 이 CSV 처리 자체엔 별도 인증키 불필요)

import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const FOOD_LARGE_CATEGORY_NAME = "음식";
// Firestore Admin SDK의 getAll()/batch 안전 상한 - 문서 수가 많을 때 이 크기로 나눠서 처리한다.
const CHUNK_SIZE = 300;

// CSV 한 줄을 RFC4180 스타일로 파싱한다(필드마다 "..."로 감싸져 있을 수도, 숫자처럼 안 감싸져
// 있을 수도 있음 - 실제 파일에서 둘 다 섞여 있는 걸 확인함). 콤마가 값 안에 있어도(따옴표 안이면)
// 안전하게 처리되고, ""는 이스케이프된 " 하나로 처리한다.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

async function main() {
  const [companyCodeArg, csvPathArg, ...rest] = process.argv.slice(2);
  if (!companyCodeArg || !csvPathArg) {
    console.error(
      '사용법: npm run seed:csv -- <companyCode> <csv경로> [--neighborhoods="동1,동2,..."]'
    );
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

  const csvPath = path.resolve(process.cwd(), csvPathArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`파일을 찾을 수 없습니다: ${csvPath}`);
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

  const neighborhoods = neighborhoodsOverride ?? company.neighborhoods ?? [];
  const signguFilter = company.signguCd ?? null;
  const districtNameFilter = company.districtCode ?? null;

  if (neighborhoods.length === 0 && !signguFilter && !districtNameFilter) {
    console.error(
      "필터할 기준이 하나도 없습니다(neighborhoods/signguCd/districtCode 전부 없음) - " +
        "이대로면 서울 전체 음식점을 다 담게 되니, --neighborhoods 옵션이나 " +
        "npm run set:signgucd / set:neighborhoods로 먼저 지역을 좁혀줘."
    );
    process.exit(1);
  }

  console.log(
    `[시작] company=${company.code} signguCd필터=${signguFilter ?? "(없음)"} ` +
      `districtCode필터=${districtNameFilter ?? "(없음)"} neighborhoods필터=${
        neighborhoods.length > 0 ? neighborhoods.join("/") : "(없음, 시군구 전체)"
      }`
  );
  console.log(`[파일] ${csvPath}`);

  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, { encoding: "utf-8" }) });

  let header: string[] | null = null;
  let colIndex: Record<string, number> = {};
  let lineNo = 0;
  let skippedNotFood = 0;
  let skippedWrongArea = 0;
  let skippedBadCoord = 0;

  const collected = new Map<
    string,
    { name: string; address: string; lat: number; lng: number; category: string | null; distanceMeters: number }
  >();

  for await (const rawLine of rl) {
    lineNo += 1;
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;

    if (!header) {
      header = parseCsvLine(line);
      colIndex = Object.fromEntries(header.map((name, i) => [name, i]));
      continue;
    }

    const cols = parseCsvLine(line);
    const get = (name: string) => cols[colIndex[name]] ?? "";

    if (get("상권업종대분류명") !== FOOD_LARGE_CATEGORY_NAME) {
      skippedNotFood += 1;
      continue;
    }

    const signguCd = get("시군구코드");
    const districtName = get("시군구명");
    const dongName = get("법정동명");

    if (signguFilter && signguCd !== signguFilter) {
      skippedWrongArea += 1;
      continue;
    }
    if (!signguFilter && districtNameFilter && !districtName.includes(districtNameFilter)) {
      skippedWrongArea += 1;
      continue;
    }
    if (neighborhoods.length > 0 && !neighborhoods.includes(dongName)) {
      skippedWrongArea += 1;
      continue;
    }

    const lng = Number(get("경도"));
    const lat = Number(get("위도"));
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      skippedBadCoord += 1;
      continue;
    }

    const name = [get("상호명"), get("지점명")].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const address = get("도로명주소") || get("지번주소");
    const category = get("상권업종중분류명") || get("상권업종소분류명") || null;
    const id = makeRestaurantId(name, address);
    const distanceMeters = haversineMeters(company.centerLat, company.centerLng, lat, lng);

    const existing = collected.get(id);
    if (existing && existing.distanceMeters <= distanceMeters) continue;

    collected.set(id, { name, address, lat, lng, category, distanceMeters: Math.round(distanceMeters) });

    if (lineNo % 100000 === 0) {
      console.log(`  ...${lineNo}행 처리, 지금까지 필터 통과 ${collected.size}곳`);
    }
  }

  console.log(
    `[파싱 완료] 총 ${lineNo - 1}행 중 음식점 아님 ${skippedNotFood}건, 지역 불일치 ${skippedWrongArea}건, ` +
      `좌표 이상 ${skippedBadCoord}건 제외 → CSV 기준 후보 ${collected.size}곳`
  );

  if (collected.size === 0) {
    console.log("후보가 0곳이야. 필터(시군구/동 이름)가 CSV의 실제 값과 맞는지 확인해줘.");
    return;
  }

  const restaurantsRef = db.collection("companies").doc(company.code).collection("restaurants");
  const ids = Array.from(collected.keys());

  // 이미 있는 문서는 절대 덮어쓰지 않는다 - db.getAll()로 한 번에 여러 문서 존재 여부를
  // 확인해서(개별 get() N번보다 훨씬 적은 요청), 없는 것만 골라 새로 만든다.
  const existingIds = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunkIds = ids.slice(i, i + CHUNK_SIZE);
    const refs = chunkIds.map((id) => restaurantsRef.doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      if (snap.exists) existingIds.add(chunkIds[idx]);
    });
  }

  const toCreate = ids.filter((id) => !existingIds.has(id));
  console.log(
    `[중복 확인 완료] 이미 있는 식당 ${existingIds.size}곳은 건너뜀, 새로 추가할 식당 ${toCreate.length}곳`
  );

  if (toCreate.length === 0) {
    console.log("새로 추가할 식당이 없어요. 전부 이미 등록돼 있었습니다.");
    return;
  }

  for (let i = 0; i < toCreate.length; i += 500) {
    const chunk = toCreate.slice(i, i + 500);
    const batch = db.batch();
    for (const id of chunk) {
      const restaurant = collected.get(id)!;
      batch.set(restaurantsRef.doc(id), {
        name: restaurant.name,
        address: restaurant.address,
        lat: restaurant.lat,
        lng: restaurant.lng,
        category: restaurant.category,
        isZeroPay: false,
        distanceMeters: restaurant.distanceMeters,
        source: "opendata",
        seededAt: new Date().toISOString(),
      });
    }
    await batch.commit();
    console.log(`  ...저장 ${Math.min(i + 500, toCreate.length)}/${toCreate.length}`);
  }

  console.log(`[완료] companies/${company.code}/restaurants 에 새 식당 ${toCreate.length}곳을 추가했습니다.`);
}

main().catch((err) => {
  console.error("[실패]", err);
  process.exit(1);
});
