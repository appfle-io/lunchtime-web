// 네이버맵 제로페이 가맹점 확인 - 네트워크 인터셉트 방식
// Playwright로 실제 브라우저를 띄워 네이버맵 내부 API 응답을 가로챔.
// 사용법: npx tsx scripts/test-naver-zeropay-playwright.ts

import { chromium, type Page, type BrowserContext } from "playwright";

const TEST_RESTAURANTS = [
  { name: "GS25 영등포충무점", address: "서울 영등포구" },
  { name: "스타벅스 영등포타임스퀘어점", address: "서울 영등포구" },
  { name: "맥도날드 영등포점", address: "서울 영등포구" },
  { name: "교촌치킨 영등포점", address: "서울 영등포구" },
  { name: "이마트24 영등포역점", address: "서울 영등포구" },
];

interface PlaceResult {
  name: string;
  placeId: string | null;
  isZeroPay: boolean;
  paymentMethods: string[];
  phone?: string;
  hours?: string;
  error?: string;
}

// ──────────────────────────────────────────────
// Step 1: 가게명 검색 → placeId 획득
//   네이버맵이 검색할 때 호출하는 내부 API 응답을 인터셉트
// ──────────────────────────────────────────────
async function searchPlaceId(
  context: BrowserContext,
  name: string
): Promise<string | null> {
  const page = await context.newPage();

  try {
    let capturedPlaceId: string | null = null;

    // 네이버맵 검색 API 응답 인터셉트
    page.on("response", async (response) => {
      const url = response.url();
      // allSearch API 응답 캡처
      if (url.includes("/api/search/allSearch") || url.includes("/api/search/place")) {
        try {
          const json = await response.json().catch(() => null);
          if (!json) return;

          const places =
            json?.result?.place?.list ??
            json?.result?.place?.items ??
            [];

          if (places.length > 0 && !capturedPlaceId) {
            capturedPlaceId = String(places[0].id ?? places[0].placeId ?? "");
            const n = places[0].name ?? places[0].title ?? "";
            console.log(`  [인터셉트] 검색결과: "${n}" id=${capturedPlaceId}`);
          }
        } catch (_) {}
      }

      // 개별 place 페이지 URL에서도 추출
      if (url.includes("/place/list/") || url.includes("/place/summary")) {
        const m = url.match(/\/place\/(?:list|summary)\/(\d+)/);
        if (m && !capturedPlaceId) {
          capturedPlaceId = m[1];
          console.log(`  [URL 추출] placeId=${capturedPlaceId}`);
        }
      }
    });

    const searchUrl = `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
    console.log(`  → ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "load", timeout: 30000 });

    // JS 렌더링 + 검색 결과 로딩 대기
    await page.waitForTimeout(5000);

    // placeId가 아직 없으면 현재 URL에서 추출 시도
    if (!capturedPlaceId) {
      const currentUrl = page.url();
      const m = currentUrl.match(/[?&]entry\/place\/(\d+)|\/place\/(\d+)/);
      if (m) capturedPlaceId = m[1] || m[2];
    }

    // placeId가 없으면 직접 첫 번째 결과 링크 href 파싱
    if (!capturedPlaceId) {
      // 모든 링크에서 place ID 형태 탐색
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h.includes("place") || h.includes("entry"))
      );

      for (const href of hrefs.slice(0, 20)) {
        const m = href.match(/\/place\/(\d+)|entry\/place\/(\d+)/);
        if (m) {
          capturedPlaceId = m[1] || m[2];
          console.log(`  [href 파싱] placeId=${capturedPlaceId} from ${href}`);
          break;
        }
      }
    }

    return capturedPlaceId;
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────
// Step 2: placeId → 정보 탭(결제수단) 파싱
//   pcmap.place.naver.com/restaurant/{id}/info 로 직접 이동
// ──────────────────────────────────────────────
async function fetchPlaceInfo(
  context: BrowserContext,
  placeId: string
): Promise<Omit<PlaceResult, "name" | "placeId" | "error">> {
  const page = await context.newPage();

  try {
    let paymentData: string[] = [];
    let phone: string | undefined;
    let hours: string | undefined;

    // GraphQL / REST API 응답 인터셉트
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("pcmap-api.place.naver.com") ||
        url.includes("place.map.naver.com")
      ) {
        try {
          const text = await response.text().catch(() => "");
          if (text.includes("제로페이") || text.includes("ZERO_PAY") || text.includes("zeropay")) {
            console.log(`  [API 인터셉트] 제로페이 키워드 발견! url=${url.slice(0, 80)}`);
            // payment 관련 값 추출
            const matches = text.match(/"([^"]*[Pp]ay[^"]*)"/g) ?? [];
            paymentData.push(...matches.map((m) => m.replace(/"/g, "")));
          }
        } catch (_) {}
      }
    });

    // 정보 탭 직접 접근 (restaurant/place 두 가지 경로 시도)
    const infoUrls = [
      `https://pcmap.place.naver.com/restaurant/${placeId}/info`,
      `https://pcmap.place.naver.com/place/${placeId}/info`,
    ];

    let bodyText = "";
    for (const url of infoUrls) {
      try {
        await page.goto(url, { waitUntil: "load", timeout: 20000 });
        await page.waitForTimeout(4000);
        bodyText = (await page.textContent("body")) ?? "";
        if (bodyText.length > 200) break; // 내용이 있으면 성공
      } catch (_) {}
    }

    // body text에서 결제수단 파싱
    const payMethods: string[] = [];
    const payKeywords = ["제로페이", "네이버페이", "카카오페이", "신용카드", "체크카드", "현금", "삼성페이", "애플페이"];
    for (const kw of payKeywords) {
      if (bodyText.includes(kw)) payMethods.push(kw);
    }

    // 전화번호
    const phoneMatch = bodyText.match(/\d{2,3}-\d{3,4}-\d{4}/);
    if (phoneMatch) phone = phoneMatch[0];

    // 영업시간 (간략히)
    const hoursMatch = bodyText.match(/(?:영업시간|운영시간)[^\n]*\n?([^\n]{5,50})/);
    if (hoursMatch) hours = hoursMatch[1].trim();

    // API 인터셉트로 잡힌 것도 합산
    for (const kw of payKeywords) {
      if (paymentData.some((d) => d.includes(kw)) && !payMethods.includes(kw)) {
        payMethods.push(kw);
      }
    }

    const isZeroPay = payMethods.includes("제로페이");

    if (bodyText.length < 200) {
      console.log(`  [경고] 페이지 내용이 너무 짧음 (${bodyText.length}자) - 로딩 실패 가능성`);
      console.log(`  [body 앞부분] ${bodyText.slice(0, 200)}`);
    }

    return { isZeroPay, paymentMethods: payMethods, phone, hours };
  } finally {
    await page.close();
  }
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────
async function main() {
  console.log("=== 네이버맵 제로페이 가맹점 확인 (네트워크 인터셉트) ===\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--lang=ko-KR"],
  });

  const context = await browser.newContext({
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  const results: PlaceResult[] = [];

  for (const restaurant of TEST_RESTAURANTS) {
    console.log(`\n📍 ${restaurant.name}`);
    console.log("─".repeat(55));

    const result: PlaceResult = {
      name: restaurant.name,
      placeId: null,
      isZeroPay: false,
      paymentMethods: [],
    };

    try {
      // Step 1: placeId 검색
      const placeId = await searchPlaceId(context, restaurant.name);
      result.placeId = placeId;

      if (!placeId) {
        console.log("  → placeId 획득 실패");
        result.error = "placeId not found";
      } else {
        console.log(`  → placeId: ${placeId}`);

        // Step 2: 결제수단 등 상세 정보
        const info = await fetchPlaceInfo(context, placeId);
        Object.assign(result, info);
      }
    } catch (err) {
      result.error = (err as Error).message;
      console.log(`  → 오류: ${result.error}`);
    }

    results.push(result);
    console.log(`\n  결과:`);
    console.log(`    placeId     : ${result.placeId ?? "N/A"}`);
    console.log(`    제로페이     : ${result.isZeroPay ? "🟢 YES" : "🔴 NO"}`);
    console.log(`    결제수단     : ${result.paymentMethods.join(", ") || "정보없음"}`);
    if (result.phone) console.log(`    전화번호     : ${result.phone}`);
    if (result.hours) console.log(`    영업시간     : ${result.hours}`);
    if (result.error) console.log(`    오류         : ${result.error}`);

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n\n=== 최종 요약 ===");
  for (const r of results) {
    const icon = r.isZeroPay ? "🟢" : r.error ? "⚠️" : "🔴";
    console.log(`${icon} ${r.name.padEnd(25)} | placeId: ${r.placeId ?? "N/A"} | 제로페이: ${r.isZeroPay}`);
  }

  await browser.close();
}

main().catch(console.error);
