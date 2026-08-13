import { db } from "@/lib/firebase";
import { invalidateRestaurantsCache, toRestaurantSummary } from "@/lib/restaurant-server";
import {
  lookupNaverPlaceDetail,
  resolveNaverPlaceId,
  fetchNaverPlaceFullDetails,
} from "@/lib/naver-place-detail";
import { checkZeroPayOfficial } from "@/lib/zeropay-official";
import { CATEGORY_LABELS } from "@/lib/restaurant-category";
import type { RestaurantSummary } from "@/types";

export interface EnrichResult {
  restaurant: RestaurantSummary;
  enrichedFields: {
    naverPlaceId?: string;
    naverPlaceUrl?: string;
    phone?: string;
    isZeroPay?: boolean;
    zeroPaySource?: string;
    categoryLabel?: string;
    menusCount?: number;
  };
}

/**
 * 특정 가맹점의 제로페이 공식 가맹 여부 및 네이버맵 상세 정보(전화번호, 영업시간, 메뉴, 편의시설 등)를
 * 수집/검증하여 DB를 업데이트하고 최신 식당 객체를 반환합니다.
 * 
 * [주의] 네이버맵 텍스트에 "제로페이"가 들어있더라도 그것으로 isZeroPay를 true로 만들지 않습니다.
 * 제로페이 여부는 반드시 대한민국 제로페이 공식 서버(zeropay.or.kr) 조회 또는 사내 사용자 투표(thumbs up)로만 결정됩니다.
 */
export async function enrichRestaurantById(
  companyCode: string,
  restaurantId: string,
  options: { skipZeroPay?: boolean } = {}
): Promise<EnrichResult> {
  const companyDocRef = db.collection("companies").doc(companyCode);
  const companySnap = await companyDocRef.get();
  if (!companySnap.exists) {
    throw new Error(`회사 정보를 찾을 수 없습니다. (companyCode: ${companyCode})`);
  }

  const rawDistrict: string = companySnap.data()?.districtCode ?? "";
  const districtKeyword = rawDistrict.replace(/(구|시|군)$/, "").trim() || undefined;

  const docRef = companyDocRef.collection("restaurants").doc(restaurantId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new Error(`식당을 찾을 수 없습니다. (id: ${restaurantId})`);
  }

  const storeData = docSnap.data()!;
  const name: string = storeData.name ?? "";
  const address: string = storeData.address ?? "";
  const rawCategory: string | null = storeData.category ?? null;

  const existingPlaceId: string = storeData.naverPlaceId ?? "";
  const existingPlaceUrl: string = storeData.naverPlaceUrl ?? "";

  const update: Record<string, unknown> = {
    isEnriched: true,
    enrichedAt: new Date().toISOString(),
  };
  const enrichedSummary: EnrichResult["enrichedFields"] = {};

  // 1. 네이버 Place ID 파싱 또는 검색
  let placeId = existingPlaceId || (await resolveNaverPlaceId(existingPlaceUrl));

  if (!placeId) {
    try {
      const naverDetail = await lookupNaverPlaceDetail(name, { districtKeyword });
      if (naverDetail?.naverPlaceId) {
        placeId = naverDetail.naverPlaceId;
      }
    } catch (naverErr) {
      console.warn(`[enrich-server] "${name}" 네이버 Place 검색 예외:`, naverErr);
    }
  }

  // 2. 네이버 Place 상세 정보(메뉴, 영업시간, 전화번호, 편의시설 등) 수집
  if (placeId) {
    try {
      const fullDetails = await fetchNaverPlaceFullDetails(placeId);
      if (fullDetails) {
        update.naverPlaceId = fullDetails.naverPlaceId;
        update.naverPlaceUrl = fullDetails.naverPlaceUrl;
        update.naverMatchedName = fullDetails.matchedName || name;
        update.naverMatchedAddress = fullDetails.matchedAddress || address;
        enrichedSummary.naverPlaceId = fullDetails.naverPlaceId;
        enrichedSummary.naverPlaceUrl = fullDetails.naverPlaceUrl;

        if (fullDetails.phone) {
          update.phone = fullDetails.phone;
          enrichedSummary.phone = fullDetails.phone;
        }

        if (fullDetails.businessHours) {
          update.businessHours = fullDetails.businessHours;
        }

        if (fullDetails.facilities && fullDetails.facilities.length > 0) {
          update.facilities = fullDetails.facilities;
        }

        if (fullDetails.paymentMethods && fullDetails.paymentMethods.length > 0) {
          update.paymentMethods = fullDetails.paymentMethods;
        }

        if (fullDetails.menus && fullDetails.menus.length > 0) {
          update.menus = fullDetails.menus;
          enrichedSummary.menusCount = fullDetails.menus.length;
        }

        if (fullDetails.aiBriefing) {
          update.aiBriefing = fullDetails.aiBriefing;
        }

        if (fullDetails.mainImage) {
          update.mainImage = fullDetails.mainImage;
        }
      }
    } catch (fullDetailErr) {
      console.warn(`[enrich-server] "${name}" 네이버 상세 수집 예외:`, fullDetailErr);
    }
  }

  // 3. 제로페이 공식 DB (zeropay.or.kr) 교차 검증 (skipZeroPay가 아닐 때만 실행)
  if (!options.skipZeroPay) {
    try {
      const officialZeroPay = await checkZeroPayOfficial(name, address);
      if (officialZeroPay.isZeroPay) {
        update.isZeroPay = true;
        update.zeroPaySource = "zeropay_official";
        update.zeroPayEnrichedAt = new Date().toISOString();
        if (officialZeroPay.officialName) update.zeroPayOfficialName = officialZeroPay.officialName;
        if (officialZeroPay.officialAddress) update.zeroPayOfficialAddress = officialZeroPay.officialAddress;

        enrichedSummary.isZeroPay = true;
        enrichedSummary.zeroPaySource = "zeropay_official";
      }
    } catch (zpErr) {
      console.warn(`[enrich-server] "${name}" 제로페이 공식 조회 예외:`, zpErr);
    }
  }

  // 4. Gemini 카테고리 AI 자동 분류
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const GEMINI_ENDPOINT =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
      const prompt = `한국 식당 이름과 업종을 보고 아래 라벨 중 하나로만 분류하세요.
라벨: ${CATEGORY_LABELS.join(", ")}
식당 이름: ${name}
주소: ${address}
업종: ${rawCategory ?? "(없음)"}
JSON으로만 답하세요: {"label": "라벨"}`;

      const res = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text: string =
          data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
        const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
        if (parsed?.label && CATEGORY_LABELS.includes(parsed.label)) {
          update.categoryLabel = parsed.label;
          enrichedSummary.categoryLabel = parsed.label;
        }
      }
    }
  } catch (catErr) {
    console.warn(`[enrich-server] "${name}" 카테고리 분류 예외:`, catErr);
  }

  // DB 업데이트 및 캐시 무효화
  if (Object.keys(update).length > 0) {
    await docRef.set(update, { merge: true });
    invalidateRestaurantsCache(companyCode);
  }

  const updatedSnap = await docRef.get();
  const updatedData = updatedSnap.data()!;

  return {
    restaurant: toRestaurantSummary(restaurantId, updatedData),
    enrichedFields: enrichedSummary,
  };
}
