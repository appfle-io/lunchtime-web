import { type BrowserContext } from "playwright";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 네이버가 응답하지 않으면 관리자 점검/식당 추가 요청 전체가 멈추므로 요청마다 시간 제한을 둔다.
const NAVER_TIMEOUT_MS = 8_000;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(NAVER_TIMEOUT_MS) });
}

/** 네이버 검색에서 찾은 플레이스 후보. 이름/주소는 지도 검색 결과에서만 채워진다 (통합검색은 ID만 준다). */
export interface NaverPlaceCandidate {
  naverPlaceId: string;
  matchedName: string;
  matchedAddress: string;
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
      const res = await fetchWithTimeout(inputUrl, { method: "HEAD", redirect: "follow" });
      const finalUrl = res.url;
      const extracted = extractNaverPlaceId(finalUrl);
      if (extracted) return extracted;
    } catch {
      try {
        const res = await fetchWithTimeout(inputUrl, { method: "GET", redirect: "follow" });
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
    const res = await fetchWithTimeout(url, {
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

/**
 * 상호로 네이버 플레이스 후보를 찾는다. 결과를 그대로 믿지 않는다: 호출하는 쪽이 각 후보의 상세 정보를 받아
 * `judgeNaverPlaceMatch`(naver-match.ts)로 DB 식당과 같은 가게인지 확인한 뒤에만 반영해야 한다.
 * (예전 lookupNaverPlaceDetail은 첫 결과를 검증 없이 써서 다른 지역/다른 가게 정보가 붙었다.)
 */
export async function searchNaverPlaceCandidates(
  name: string,
  options: { districtKeyword?: string; limit?: number } = {}
): Promise<NaverPlaceCandidate[]> {
  const { districtKeyword, limit = 3 } = options;
  const query = districtKeyword ? `${districtKeyword} ${name}` : name;
  const found = new Map<string, NaverPlaceCandidate>();

  // 1. 지도 검색: 이름과 주소가 같이 오므로 우선 쓴다.
  try {
    const searchUrl = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(query)}&type=all&searchCoord=126.9075977%3B37.5198698`;
    const res = await fetchWithTimeout(searchUrl, {
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
        if (!pid || found.has(pid)) continue;
        found.set(pid, {
          naverPlaceId: pid,
          matchedName: String(p.name ?? p.title ?? ""),
          matchedAddress: String(p.roadAddress ?? p.address ?? p.jibunAddress ?? ""),
        });
        if (found.size >= limit) break;
      }
    }
  } catch (_) {}

  // 2. 통합검색 HTML: 지도 검색이 막히거나 결과가 없을 때. 페이지에 나온 순서대로 ID만 모은다.
  if (found.size < limit) {
    try {
      const searchUrl = `https://search.naver.com/search.naver?where=nexsearch&query=${encodeURIComponent(query)}`;
      const res = await fetchWithTimeout(searchUrl, {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept-Language": "ko-KR,ko;q=0.9",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const re = /map\.naver\.com\/p\/entry\/place\/(\d+)|place\.naver\.com\/(?:restaurant|place)\/(\d+)/gi;
        for (const m of Array.from(html.matchAll(re))) {
          const pid = m[1] || m[2];
          if (!pid || found.has(pid)) continue;
          found.set(pid, { naverPlaceId: pid, matchedName: "", matchedAddress: "" });
          if (found.size >= limit) break;
        }
      }
    } catch (_) {}
  }

  return Array.from(found.values());
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
