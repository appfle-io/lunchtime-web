import { chromium, type BrowserContext } from "playwright";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface NaverPlaceDetail {
  naverPlaceId: string;
  matchedName: string;
  matchedAddress: string;
  phone?: string;
}

export interface NaverPlaceDetailOptions {
  minSimilarity?: number;
  districtKeyword?: string;
  context?: BrowserContext;
}

interface CapturedPlace {
  id: string;
  name: string;
  address: string;
  phone?: string;
}

export async function lookupNaverPlaceDetail(
  name: string,
  options: NaverPlaceDetailOptions = {}
): Promise<NaverPlaceDetail | null> {
  const { districtKeyword } = options;
  const ownContext = !options.context;

  let browser;
  let context = options.context;

  if (ownContext) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      locale: "ko-KR",
      userAgent: BROWSER_UA,
    });
  }

  try {
    const searchPage = await context!.newPage();
    let capturedItem: CapturedPlace | null = null;

    searchPage.on("response", async (response) => {
      if (capturedItem) return;
      const url = response.url();
      if (!url.includes("/api/search/allSearch") && !url.includes("/api/search/place")) return;

      try {
        const json = await response.json().catch(() => null);
        if (!json) return;
        const places = json?.result?.place?.list ?? json?.result?.place?.items ?? [];

        for (const p of places) {
          const pid = String(p.id ?? p.placeId ?? "");
          const pname = String(p.name ?? p.title ?? "");
          const paddr = String(p.roadAddress ?? p.address ?? p.jibunAddress ?? "");
          const tel = String(p.tel ?? p.phone ?? "").trim() || undefined;

          if (!pid) continue;
          if (districtKeyword && !paddr.includes(districtKeyword)) continue;

          capturedItem = { id: pid, name: pname, address: paddr, phone: tel };
          break;
        }
      } catch (_) {}
    });

    await searchPage.goto(`https://map.naver.com/p/search/${encodeURIComponent(name)}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await searchPage.waitForTimeout(3000);
    await searchPage.close();

    if (!capturedItem) return null;

    const finalCaptured: CapturedPlace = capturedItem;

    return {
      naverPlaceId: finalCaptured.id,
      matchedName: finalCaptured.name,
      matchedAddress: finalCaptured.address,
      phone: finalCaptured.phone,
    };
  } finally {
    if (ownContext && browser) {
      await browser.close();
    }
  }
}
