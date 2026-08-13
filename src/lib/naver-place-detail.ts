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

export interface NaverEnrichedMenuItem {
  name: string;
  price: string;
  description?: string;
  image?: string | null;
  isRepresentative?: boolean;
}

export interface NaverPlaceFullDetails {
  naverPlaceId: string;
  naverPlaceUrl: string;
  matchedName: string;
  matchedAddress: string;
  phone: string | null;
  businessHours: any | null;
  facilities: string[];
  paymentMethods: string[];
  aiBriefing: string | null;
  menus: NaverEnrichedMenuItem[];
  mainImage: string | null;
  isZeroPay: boolean;
}

interface CapturedPlace {
  id: string;
  name: string;
  address: string;
  phone?: string;
}

export function extractNaverPlaceId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/(?:place|restaurant)\/(\d+)/i);
  if (match) return match[1];

  const paramMatch = trimmed.match(/[?&]id=(\d+)/i);
  if (paramMatch) return paramMatch[1];

  return null;
}

export async function resolveNaverPlaceId(inputUrl: string): Promise<string | null> {
  const directId = extractNaverPlaceId(inputUrl);
  if (directId) return directId;

  if (inputUrl && inputUrl.includes("naver.me")) {
    try {
      const res = await fetch(inputUrl, { method: "HEAD", redirect: "follow" });
      const finalUrl = res.url;
      const extracted = extractNaverPlaceId(finalUrl);
      if (extracted) return extracted;
    } catch {
      try {
        const res = await fetch(inputUrl, { method: "GET", redirect: "follow" });
        const finalUrl = res.url;
        return extractNaverPlaceId(finalUrl);
      } catch (_) {}
    }
  }
  return null;
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

export async function fetchNaverPlaceFullDetails(
  placeId: string,
  existingContext?: BrowserContext
): Promise<NaverPlaceFullDetails | null> {
  const ownContext = !existingContext;
  let browser;
  let context = existingContext;

  if (ownContext) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      locale: "ko-KR",
      userAgent: BROWSER_UA,
    });
  }

  const page = await context!.newPage();

  try {
    const homeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
    const placeDirectUrl = `https://map.naver.com/p/entry/place/${placeId}`;

    let homeData: any = null;

    try {
      await page.goto(homeUrl, { waitUntil: "load", timeout: 15000 });
      await page.waitForTimeout(1500);

      homeData = await page.evaluate(() => {
        const win = window as any;
        const apollo = win.__APOLLO_STATE__ || {};
        const baseKey = Object.keys(apollo).find((k) => k.startsWith("PlaceDetailBase:"));
        const base = baseKey ? apollo[baseKey] : {};

        const menuKeys = Object.keys(apollo).filter((k) => k.startsWith("Menu:"));
        const menus = menuKeys
          .map((k) => {
            const item = apollo[k];
            return {
              name: item.name ?? "",
              price: item.price ?? "",
              description: item.description ?? "",
              image: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
            };
          })
          .filter((m) => m.name);

        let bizHours = base.openingHours || base.bizhourInfo || null;
        let aiBriefing = null;
        if (Array.isArray(base.microReviews) && base.microReviews.length > 0) {
          aiBriefing = base.microReviews[0];
        } else if (typeof base.smartSummary === "string") {
          aiBriefing = base.smartSummary;
        }

        return {
          phone: base.phone || base.virtualPhone || null,
          facilities: Array.isArray(base.conveniences)
            ? base.conveniences
            : Array.isArray(base.facilityInfo)
            ? base.facilityInfo
            : [],
          paymentMethods: Array.isArray(base.paymentInfo) ? base.paymentInfo : [],
          aiBriefing,
          businessHours: bizHours,
          menus: menus.slice(0, 15),
          name: base.name || null,
          address: base.roadAddress || base.address || null,
        };
      });
    } catch (err) {
      console.warn(`[fetchNaverPlaceFullDetails] 홈 페이지 접근 실패 (id: ${placeId}):`, err);
    }

    if (!homeData) {
      return null;
    }

    // 정형 openingHours가 없는 경우 DOM '펼쳐보기' 클릭 후 텍스트 전체 수집
    if (!homeData.businessHours) {
      try {
        const domBizHours = await page.evaluate(async () => {
          const foldLink =
            (document.querySelector("a.gKP9i") ||
            document.querySelector("div.vV_z_ a") ||
            document.querySelector("div.O8qbU.pSavy a")) as HTMLElement;

          if (foldLink) {
            foldLink.click();
            await new Promise((r) => setTimeout(r, 600));
          }

          const container = document.querySelector("div.O8qbU.pSavy") || document.querySelector("div.vV_z_");
          if (!container) return null;

          const text = (container as HTMLElement).innerText;
          const lines = text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);

          const cleanLines = lines.filter(
            (l) => !["영업시간", "접기", "영업시간 수정 제안하기", "영업시간 복사"].includes(l)
          );
          return cleanLines.length > 0 ? cleanLines.join("\n") : null;
        });

        if (domBizHours) {
          homeData.businessHours = domBizHours;
        }
      } catch (domErr) {
        console.warn(`[fetchNaverPlaceFullDetails] DOM 영업시간 수집 실패 (id: ${placeId}):`, domErr);
      }
    }

    let mainImage: string | null = null;
    let enrichedMenus: NaverEnrichedMenuItem[] = homeData.menus;

    // 모바일 메뉴 목록 탭 추가 수집
    try {
      await page.goto(`https://m.place.naver.com/restaurant/${placeId}/menu/list`, {
        waitUntil: "load",
        timeout: 12000,
      });
      await page.waitForTimeout(1200);

      const imageData = await page.evaluate(() => {
        const win = window as any;
        const apollo = win.__APOLLO_STATE__ || {};

        let imageUrl: string | null = null;
        const baseKey = Object.keys(apollo).find(
          (k) => k.startsWith("PlaceDetailBase:") || k.startsWith("Restaurant:")
        );
        const base = baseKey ? apollo[baseKey] : {};

        if (Array.isArray(base.headerImages) && base.headerImages.length > 0) {
          imageUrl = base.headerImages[0].url || base.headerImages[0];
        } else if (Array.isArray(base.images) && base.images.length > 0) {
          imageUrl = base.images[0].url || base.images[0];
        }
        if (!imageUrl) {
          const photoKeys = Object.keys(apollo).filter((k) => k.startsWith("Photo:"));
          if (photoKeys.length > 0) {
            imageUrl = apollo[photoKeys[0]].url || apollo[photoKeys[0]].imageUrl || null;
          }
        }

        const menus: NaverEnrichedMenuItem[] = [];
        const baeminMenuKeys = Object.keys(apollo).filter((k) => k.startsWith("PlaceDetail_BaeminMenu:"));
        const regularMenuKeys = Object.keys(apollo).filter((k) => k.startsWith("Menu:"));

        baeminMenuKeys.forEach((k) => {
          const item = apollo[k];
          if (item && item.name) {
            const imgList = Array.isArray(item.images) ? item.images : [];
            const validImg = imgList.find((img: string) => img && img.trim().length > 0) || null;
            menus.push({
              name: item.name,
              price: item.price ?? "",
              description: item.desc ?? item.description ?? "",
              image: validImg,
              isRepresentative: item.isRepresentative ?? false,
            });
          }
        });

        regularMenuKeys.forEach((k) => {
          const item = apollo[k];
          if (item && item.name) {
            const exists = menus.some((m) => m.name.replace(/\s+/g, "") === item.name.replace(/\s+/g, ""));
            if (!exists) {
              const imgList = Array.isArray(item.images) ? item.images : [];
              const validImg = imgList.find((img: string) => img && img.trim().length > 0) || null;
              menus.push({
                name: item.name,
                price: item.price ?? "",
                description: item.description ?? "",
                image: validImg,
                isRepresentative: item.recommend ?? false,
              });
            }
          }
        });

        return { imageUrl, menus: menus.slice(0, 15) };
      });

      mainImage = imageData.imageUrl;
      if (imageData.menus.length > 0) {
        enrichedMenus = imageData.menus;
      }
    } catch (_) {
      // 모바일 메뉴 실패 시 홈 메뉴 사용
    }

    const paymentMethods: string[] = homeData.paymentMethods || [];
    const isZeroPay = paymentMethods.some((pm: string) => pm.includes("제로페이"));

    return {
      naverPlaceId: placeId,
      naverPlaceUrl: placeDirectUrl,
      matchedName: homeData.name || "",
      matchedAddress: homeData.address || "",
      phone: homeData.phone || null,
      businessHours: homeData.businessHours || null,
      facilities: homeData.facilities || [],
      paymentMethods,
      aiBriefing: homeData.aiBriefing || null,
      menus: enrichedMenus,
      mainImage,
      isZeroPay,
    };
  } finally {
    await page.close();
    if (ownContext && browser) {
      await browser.close();
    }
  }
}
