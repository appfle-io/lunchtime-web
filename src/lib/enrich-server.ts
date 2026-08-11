import { db } from "@/lib/firebase";
import { invalidateRestaurantsCache, toRestaurantSummary } from "@/lib/restaurant-server";
import { lookupNaverPlaceDetail } from "@/lib/naver-place-detail";
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
  };
}

/**
 * 특정 가맹점의 제로페이 공식 가맹 여부 및 네이버맵 상세 정보(전화번호, 영업시간, 카테고리 등)를
 * 수집/검증하여 DB를 업데이트하고 최신 식당 객체를 반환합니다.
 */
export async function enrichRestaurantById(
  companyCode: string,
  restaurantId: string
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

  const update: Record<string, unknown> = {
    isEnriched: true,
    enrichedAt: new Date().toISOString(),
  };
  const enrichedSummary: EnrichResult["enrichedFields"] = {};

  // 1. 네이버 Place 검색 및 상세 수집 시도
  try {
    const naverDetail = await lookupNaverPlaceDetail(name, { districtKeyword });
    if (naverDetail?.naverPlaceId) {
      update.naverPlaceId = naverDetail.naverPlaceId;
      update.naverPlaceUrl = `https://map.naver.com/p/entry/place/${naverDetail.naverPlaceId}`;
      update.naverMatchedName = naverDetail.matchedName;
      enrichedSummary.naverPlaceId = naverDetail.naverPlaceId;
      enrichedSummary.naverPlaceUrl = update.naverPlaceUrl as string;

      if (naverDetail.phone) {
        update.phone = naverDetail.phone;
        enrichedSummary.phone = naverDetail.phone;
      }
    }
  } catch (naverErr) {
    console.warn(`[enrich-server] "${name}" 네이버 검색 예외:`, naverErr);
  }

  // 2. 제로페이 공식 DB (zeropay.or.kr) 다변화 조회
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

  // 3. Gemini 카테고리 AI 자동 분류
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
