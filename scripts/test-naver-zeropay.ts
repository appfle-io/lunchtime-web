// 네이버맵 내부 API로 제로페이 가맹점 여부 확인 테스트
// 사용법: npx tsx scripts/test-naver-zeropay.ts

const TEST_RESTAURANTS = [
  { name: "GS25 영등포충무점", address: "서울 영등포구" },
  { name: "스타벅스 영등포타임스퀘어점", address: "서울 영등포구" },
  { name: "맥도날드 영등포점", address: "서울 영등포구" },
  { name: "교촌치킨 영등포점", address: "서울 영등포구" },
  { name: "이마트24 영등포역점", address: "서울 영등포구" },
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: "https://map.naver.com/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

// Step 1: 가게명으로 네이버맵 검색 → placeId 획득
async function searchNaverPlace(name: string, address: string): Promise<string | null> {
  const query = encodeURIComponent(`${name} ${address}`);
  const url = `https://map.naver.com/v5/api/search?caller=pcweb&query=${query}&type=all&searchCoord=&boundary=&lang=ko&start=1&display=5`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.log(`  [검색 실패] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();

    // place 결과에서 첫 번째 항목의 id 추출
    const places = json?.result?.place?.list ?? [];
    if (places.length === 0) {
      console.log(`  [검색 결과 없음]`);
      return null;
    }

    const first = places[0];
    console.log(`  [검색 결과] ${first.name} (id: ${first.id}) - ${first.roadAddress || first.address}`);
    return first.id as string;
  } catch (err) {
    console.log(`  [검색 오류] ${(err as Error).message}`);
    return null;
  }
}

// Step 2: placeId로 상세 정보(결제수단 포함) 조회
async function fetchPlaceDetail(placeId: string): Promise<{ isZeroPay: boolean; paymentMethods: string[] } | null> {
  // 네이버 플레이스 상세 API (비공식 내부 API)
  const url = `https://place.map.naver.com/place/list/${placeId}`;

  try {
    const res = await fetch(url, { headers: { ...HEADERS, Referer: `https://map.naver.com/` } });
    if (!res.ok) {
      console.log(`  [상세 조회 실패] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    console.log(`  [raw response keys] ${Object.keys(json).join(", ")}`);
    return { isZeroPay: false, paymentMethods: [] };
  } catch (err) {
    console.log(`  [상세 조회 오류] ${(err as Error).message}`);
    return null;
  }
}

// Step 2 대안: pcmap.place.naver.com API
async function fetchPlaceDetailV2(placeId: string): Promise<{ isZeroPay: boolean; paymentMethods: string[] } | null> {
  const url = `https://pcmap-api.place.naver.com/place/summary?ids=${placeId}&deviceType=pc`;

  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        Referer: `https://pcmap.place.naver.com/place/${placeId}/home`,
      },
    });
    if (!res.ok) {
      console.log(`  [상세V2 실패] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    console.log(`  [V2 raw] ${JSON.stringify(json).slice(0, 300)}`);
    return { isZeroPay: false, paymentMethods: [] };
  } catch (err) {
    console.log(`  [상세V2 오류] ${(err as Error).message}`);
    return null;
  }
}

// Step 2 대안2: 네이버 플레이스 웹 페이지에서 __NEXT_DATA__ 파싱
async function fetchPlaceDetailV3(placeId: string): Promise<{ isZeroPay: boolean; paymentMethods: string[] } | null> {
  const url = `https://pcmap.place.naver.com/restaurant/${placeId}/info`;

  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        Referer: `https://pcmap.place.naver.com/restaurant/${placeId}/home`,
      },
    });
    if (!res.ok) {
      console.log(`  [상세V3 실패] HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();

    // __NEXT_DATA__ 에서 JSON 추출
    const match = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) {
      console.log(`  [V3] __NEXT_DATA__ 없음`);
      // 결제수단 키워드 직접 검색
      const hasZeroPay = text.includes("제로페이");
      const hasNaverPay = text.includes("네이버페이");
      console.log(`  [V3 키워드] 제로페이:${hasZeroPay} 네이버페이:${hasNaverPay}`);
      return { isZeroPay: hasZeroPay, paymentMethods: [] };
    }

    const nextData = JSON.parse(match[1]);
    // 결제수단 정보 경로 탐색
    const str = JSON.stringify(nextData);
    const hasZeroPay = str.includes("제로페이") || str.includes("zeropay") || str.includes("ZEROPAY");
    const hasNaverPay = str.includes("네이버페이") || str.includes("NAVER_PAY");

    // payment 관련 키 찾기
    const paymentKeys = findKeys(nextData, ["payment", "Pay", "결제"]);
    console.log(`  [V3 결제관련 키] ${paymentKeys.slice(0, 5).join(", ")}`);
    console.log(`  [V3 키워드] 제로페이:${hasZeroPay} 네이버페이:${hasNaverPay}`);

    return { isZeroPay: hasZeroPay, paymentMethods: [] };
  } catch (err) {
    console.log(`  [상세V3 오류] ${(err as Error).message}`);
    return null;
  }
}

// JSON 객체에서 특정 키워드를 포함한 키 재귀 탐색
function findKeys(obj: unknown, keywords: string[], path = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const results: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${k}` : k;
    if (keywords.some((kw) => k.toLowerCase().includes(kw.toLowerCase()))) {
      results.push(`${fullPath}=${JSON.stringify(v).slice(0, 50)}`);
    }
    results.push(...findKeys(v, keywords, fullPath));
  }
  return results;
}

async function main() {
  console.log("=== 네이버맵 제로페이 가맹점 확인 테스트 ===\n");

  for (const restaurant of TEST_RESTAURANTS) {
    console.log(`\n📍 ${restaurant.name}`);
    console.log("─".repeat(50));

    // Step 1: placeId 검색
    const placeId = await searchNaverPlace(restaurant.name, restaurant.address);
    if (!placeId) {
      console.log("  → placeId 획득 실패, 건너뜀");
      continue;
    }

    // Step 2: 여러 방식으로 상세 정보 시도
    console.log(`\n  [방식1] place.map.naver.com/place/list/${placeId}`);
    await fetchPlaceDetail(placeId);

    console.log(`\n  [방식2] pcmap-api.place.naver.com/place/summary`);
    await fetchPlaceDetailV2(placeId);

    console.log(`\n  [방식3] pcmap.place.naver.com/restaurant/${placeId}/info`);
    const result = await fetchPlaceDetailV3(placeId);
    if (result) {
      console.log(`  → 제로페이 가맹점: ${result.isZeroPay ? "✅ YES" : "❌ NO"}`);
    }

    // Rate limit 방지
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch(console.error);
