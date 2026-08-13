import { type BrowserContext } from "playwright";

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
 * Apollo State JSON에서 영업시간 정보(openingHours, newBusinessHours 포함)를 추출합니다.
 */
function parseBusinessHoursFromApollo(apollo: any, base: any): string | null {
  if (!base && !apollo) return null;

  // 1. 기존 base.openingHours 또는 base.bizhourInfo
  const bizHours = base?.openingHours || base?.bizhourInfo;
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

  // 2. newBusinessHours (ROOT_QUERY 또는 base 내부에서 위치 탐색)
  const rootQuery = apollo?.["ROOT_QUERY"] || {};
  const placeDetailKey = Object.keys(rootQuery).find((k) => k.startsWith("placeDetail"));
  const targetObj = placeDetailKey ? rootQuery[placeDetailKey] : base;

  if (targetObj) {
    const newBizKey = Object.keys(targetObj).find((k) => k.startsWith("newBusinessHours"));
    if (newBizKey && Array.isArray(targetObj[newBizKey])) {
      const newBizList = targetObj[newBizKey];
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

    const businessHours = parseBusinessHoursFromApollo(apollo, base);
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
  const query = districtKeyword ? `${districtKeyword} ${name}` : name;

  // 1. search.naver.com 렌더링 HTML에서 Place ID 직접 추출 (Pure HTTP, Captcha 차단 없음, Vercel 100% 동작)
  try {
    const searchUrl = `https://search.naver.com/search.naver?where=nexsearch&query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });

    if (res.ok) {
      const html = await res.text();
      const match = html.match(/map\.naver\.com\/p\/entry\/place\/(\d+)|place\.naver\.com\/(?:restaurant|place)\/(\d+)/i);
      if (match) {
        const placeId = match[1] || match[2];
        if (placeId) {
          return {
            naverPlaceId: placeId,
            matchedName: name,
            matchedAddress: "",
          };
        }
      }
    }
  } catch (_) {}

  // 2. map.naver.com API 폴백
  try {
    const searchUrl = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(query)}&type=all&searchCoord=126.9075977%3B37.5198698`;
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

  return null;
}

/**
 * 네이버 플레이스 상세 정보를 수집합니다.
 * Vercel Serverless 환경에서도 동작하도록 Pure HTTP 수집을 사용합니다.
 */
export async function fetchNaverPlaceFullDetails(
  placeId: string,
  _existingContext?: BrowserContext
): Promise<NaverPlaceFullDetails | null> {
  return await fetchNaverPlaceViaPureHttp(placeId);
}
