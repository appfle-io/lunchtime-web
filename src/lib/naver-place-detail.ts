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

/**
 * Apollo State JSON 또는 HTML에서 businessHours 정보(newBusinessHours 포함)를 추출하는 헬퍼 함수
 */
function parseBusinessHoursFromApolloBase(base: any): string | null {
  if (!base) return null;

  // 1. 기존 openingHours 또는 bizhourInfo
  const bizHours = base.openingHours || base.bizhourInfo;
  if (bizHours) {
    if (typeof bizHours === "string") return bizHours;
    if (Array.isArray(bizHours) && bizHours.length > 0) {
      return bizHours
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            const day = item.day || item.title || "";
            const time = item.time || item.hours || item.businessHours || "";
            return day && time ? `${day}: ${time}` : day || time;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
  }

  // 2. newBusinessHours (예: newBusinessHours({"format":"restaurant"}))
  const newBizKey = Object.keys(base).find((k) => k.startsWith("newBusinessHours"));
  if (newBizKey && Array.isArray(base[newBizKey])) {
    const newBizList = base[newBizKey];
    if (newBizList.length > 0 && Array.isArray(newBizList[0]?.businessHours)) {
      const formatted = newBizList[0].businessHours
        .map((bh: any) => {
          const day = bh.day || "";
          if (bh.description) {
            return `${day}: ${bh.description}`;
          }
          if (bh.businessHours) {
            const times = `${bh.businessHours.start} - ${bh.businessHours.end}`;
            const lastOrder =
              Array.isArray(bh.lastOrderTimes) && bh.lastOrderTimes.length > 0
                ? ` (${bh.lastOrderTimes[0].time} 라스트오더)`
                : "";
            return `${day}: ${times}${lastOrder}`;
          }
          return day;
        })
        .filter(Boolean);

      const regularClosed = newBizList[0].comingRegularClosedDays;
      if (regularClosed) {
        formatted.push(`\n정기휴무: ${regularClosed}`);
      }

      if (formatted.length > 0) {
        return formatted.join("\n");
      }
    }
  }

  return null;
}

/**
 * Pure HTTP fetch를 사용하여 네이버 플레이스 데이터를 직접 수집하는 폴백 함수 (Vercel Serverless 환경 100% 지원)
 */
async function fetchNaverPlaceViaPureHttp(placeId: string): Promise<NaverPlaceFullDetails | null> {
  try {
    const url = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });

    if (!res.ok) return null;
    const html = await res.text();

    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});?\s*window\.__/);
    if (!apolloMatch) return null;

    const apollo = JSON.parse(apolloMatch[1]);
    const baseKey = Object.keys(apollo).find((k) => k.startsWith("PlaceDetailBase:") || k.startsWith("Restaurant:"));
    const base = baseKey ? apollo[baseKey] : {};

    const menuKeys = Object.keys(apollo).filter((k) => k.startsWith("Menu:"));
    const menus: NaverEnrichedMenuItem[] = menuKeys
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

    const businessHours = parseBusinessHoursFromApolloBase(base);
    let aiBriefing = null;
    if (Array.isArray(base.microReviews) && base.microReviews.length > 0) {
      aiBriefing = base.microReviews[0];
    } else if (typeof base.smartSummary === "string") {
      aiBriefing = base.smartSummary;
    }

    const paymentMethods: string[] = Array.isArray(base.paymentInfo) ? base.paymentInfo : [];
    const isZeroPay = paymentMethods.some((pm: string) => pm.includes("제로페이"));

    let mainImage: string | null = null;
    if (Array.isArray(base.headerImages) && base.headerImages.length > 0) {
      mainImage = base.headerImages[0].url || base.headerImages[0];
    } else if (Array.isArray(base.images) && base.images.length > 0) {
      mainImage = base.images[0].url || base.images[0];
    }

    return {
      naverPlaceId: placeId,
      naverPlaceUrl: `https://map.naver.com/p/entry/place/${placeId}`,
      matchedName: base.name || "",
      matchedAddress: base.roadAddress || base.address || "",
      phone: base.phone || base.virtualPhone || null,
      businessHours,
      facilities: Array.isArray(base.conveniences)
        ? base.conveniences
        : Array.isArray(base.facilityInfo)
        ? base.facilityInfo
        : [],
      paymentMethods,
      aiBriefing,
      menus: menus.slice(0, 15),
      mainImage,
      isZeroPay,
    };
  } catch (err) {
    console.warn(`[fetchNaverPlaceViaPureHttp] Pure HTTP 수집 실패 (id: ${placeId}):`, err);
    return null;
  }
}

export async function lookupNaverPlaceDetail(
  name: string,
  options: NaverPlaceDetailOptions = {}
): Promise<NaverPlaceDetail | null> {
  const { districtKeyword } = options;

  // 1. 먼저 Pure HTTP 네이버 지도 검색 API 호출 시도 (Playwright 불필요, Vercel 지원)
  try {
    const searchUrl = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(name)}&type=all&searchCoord=126.9075977%3B37.5198698`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://map.naver.com/",
      },
    });

    if (res.ok) {
      const json = await res.json().catch(() => null);
      const places = json?.result?.place?.list ?? json?.result?.place?.items ?? [];

      for (const p of places) {
        const pid = String(p.id ?? p.placeId ?? "");
        const pname = String(p.name ?? p.title ?? "");
        const paddr = String(p.roadAddress ?? p.address ?? p.jibunAddress ?? "");
        const tel = String(p.tel ?? p.phone ?? "").trim() || undefined;

        if (!pid) continue;
        if (districtKeyword && !paddr.includes(districtKeyword)) continue;

        return {
          naverPlaceId: pid,
          matchedName: pname,
          matchedAddress: paddr,
          phone: tel,
        };
      }
    }
  } catch (_) {}

  // 2. options.context가 있는 경우에만 Playwright 실행 (로컬 환경용)
  if (!options.context) {
    return null;
  }

  const context = options.context;

  try {
    const searchPage = await context.newPage();
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
  } catch (_) {
    return null;
  }
}

/**
 * 네이버 플레이스 상세 정보를 수집합니다.
 * Vercel Serverless 환경에서도 동작하도록 Pure HTTP 수집을 사용하며, existingContext가 넘겨진 경우에만 Playwright를 실행합니다.
 */
export async function fetchNaverPlaceFullDetails(
  placeId: string,
  existingContext?: BrowserContext
): Promise<NaverPlaceFullDetails | null> {
  // 1. 먼저 Vercel Serverless에서 100% 동작하는 Pure HTTP 수집 실행
  const pureDetails = await fetchNaverPlaceViaPureHttp(placeId);

  // existingContext가 넘어오지 않은 환경(Vercel 등)인 경우 pureDetails 결과를 바로 반환
  // chromium.launch()를 전혀 호출하지 않으므로 Playwright 아스키 박스 경고 및 Executable 예외가 발생하지 않습니다.
  if (!existingContext) {
    return pureDetails;
  }

  const context = existingContext;
  const page = await context.newPage();

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
        const baseKey = Object.keys(apollo).find((k) => k.startsWith("PlaceDetailBase:") || k.startsWith("Restaurant:"));
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

        // newBusinessHours 파싱
        if (!bizHours) {
          const newBizKey = Object.keys(base).find((k: string) => k.startsWith("newBusinessHours"));
          if (newBizKey && Array.isArray(base[newBizKey])) {
            const newBizList = base[newBizKey];
            if (newBizList.length > 0 && Array.isArray(newBizList[0]?.businessHours)) {
              const formatted = newBizList[0].businessHours
                .map((bh: any) => {
                  const day = bh.day || "";
                  if (bh.description) return `${day}: ${bh.description}`;
                  if (bh.businessHours) {
                    const times = `${bh.businessHours.start} - ${bh.businessHours.end}`;
                    const lastOrder =
                      Array.isArray(bh.lastOrderTimes) && bh.lastOrderTimes.length > 0
                        ? ` (${bh.lastOrderTimes[0].time} 라스트오더)`
                        : "";
                    return `${day}: ${times}${lastOrder}`;
                  }
                  return day;
                })
                .filter(Boolean);

              const regularClosed = newBizList[0].comingRegularClosedDays;
              if (regularClosed) formatted.push(`\n정기휴무: ${regularClosed}`);
              if (formatted.length > 0) bizHours = formatted.join("\n");
            }
          }
        }

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
      return pureDetails;
    }

    // 정형 openingHours 및 newBusinessHours가 모두 없는 경우 DOM '펼쳐보기' 클릭 후 텍스트 수집
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
      businessHours: homeData.businessHours || pureDetails?.businessHours || null,
      facilities: homeData.facilities || [],
      paymentMethods,
      aiBriefing: homeData.aiBriefing || null,
      menus: enrichedMenus.length > 0 ? enrichedMenus : (pureDetails?.menus ?? []),
      mainImage: mainImage || pureDetails?.mainImage || null,
      isZeroPay,
    };
  } finally {
    await page.close();
  }
}
