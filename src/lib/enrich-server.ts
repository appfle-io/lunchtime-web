import { db } from "@/lib/firebase";
import { invalidateRestaurantsCache, toRestaurantSummary } from "@/lib/restaurant-server";
import {
  lookupNaverPlaceDetail,
  resolveNaverPlaceId,
  fetchNaverPlaceFullDetails,
} from "@/lib/naver-place-detail";
import { checkZeroPayOfficial, checkZeroPayOfficialWithTrace, type TraceStep } from "@/lib/zeropay-official";
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

export interface EnrichTraceResult {
  enrichResult: EnrichResult;
  targetName: string;
  targetAddress: string;
  steps: TraceStep[];
  changesSummary: string[];
}

/**
 * 특정 가맹점의 제로페이 공식 가맹 여부 및 네이버맵 상세 정보(전화번호, 영업시간, 메뉴, 편의시설 등)를
 * 수집/검증하여 DB를 업데이트하고 최신 식당 객체를 반환합니다.
 * 
 * [주의] 네이버맵 텍스트에 "제로페이"가 들어있더라도 그것으로 isZeroPay를 true로 만들지 않습니다.
 * 제로페이 여부는 반드시 대한민국 제로페이 공식 서버(zeropay.or.kr) 조회 또는 사내 사용자 투표(thumbs up)로만 결정됩니다.
 */
export async function enrichRestaurantByIdWithTrace(
  companyCode: string,
  restaurantId: string,
  options: { skipZeroPay?: boolean; saveToDb?: boolean } = { saveToDb: true }
): Promise<EnrichTraceResult> {
  const steps: TraceStep[] = [];
  const changesSummary: string[] = [];

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
  const currentPhone = (storeData.phone as string) ?? null;
  const currentZeroPay = Boolean(storeData.isZeroPay);
  const currentMenus = Array.isArray(storeData.menus) ? storeData.menus : [];

  steps.push({
    step: "1. 대상 가맹점 정보 로드",
    status: "info",
    message: `식당: '${name}', 주소: '${address}', 카테고리: '${rawCategory ?? "(없음)"}'`,
    details: { name, address, rawCategory, districtKeyword, existingPlaceId, existingPlaceUrl },
  });

  const update: Record<string, unknown> = {
    isEnriched: true,
    enrichedAt: new Date().toISOString(),
  };
  const enrichedSummary: EnrichResult["enrichedFields"] = {};

  // 1. 네이버 Place ID 파싱 또는 검색
  let placeId = existingPlaceId || (await resolveNaverPlaceId(existingPlaceUrl));

  if (placeId) {
    steps.push({
      step: "2. 네이버 Place ID 확인",
      status: "pass",
      message: `기존 등록된 Place ID 확인: '${placeId}' (URL: ${existingPlaceUrl || "없음"})`,
      details: { placeId },
    });
  } else {
    try {
      const naverDetail = await lookupNaverPlaceDetail(name, { districtKeyword });
      if (naverDetail?.naverPlaceId) {
        placeId = naverDetail.naverPlaceId;
        steps.push({
          step: "2. 네이버 Place 검색 및 ID 획득",
          status: "pass",
          message: `네이버 지역 검색 ➔ Place ID '${placeId}' 발견 (검색매칭명: '${naverDetail.matchedName}', 주소: '${naverDetail.matchedAddress}')`,
          details: { placeId, matchedName: naverDetail.matchedName, matchedAddress: naverDetail.matchedAddress },
        });
      } else {
        steps.push({
          step: "2. 네이버 Place 검색",
          status: "fail",
          message: `네이버 지역 검색을 시도했으나 '${name}'에 일치하는 Place ID를 찾지 못했습니다.`,
          details: { name, districtKeyword },
        });
      }
    } catch (naverErr) {
      steps.push({
        step: "2. 네이버 Place 검색",
        status: "fail",
        message: `네이버 검색 API 호출 예외: ${(naverErr as Error).message}`,
      });
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

        const collectedItems: string[] = [];

        if (fullDetails.phone) {
          update.phone = fullDetails.phone;
          enrichedSummary.phone = fullDetails.phone;
          if (fullDetails.phone !== currentPhone) {
            changesSummary.push(`전화번호: ${currentPhone ?? "(없음)"} ➔ ${fullDetails.phone}`);
          }
          collectedItems.push(`전화: ${fullDetails.phone}`);
        }

        if (fullDetails.businessHours) {
          update.businessHours = fullDetails.businessHours;
          collectedItems.push("영업시간 파싱 완료");
        }

        if (fullDetails.facilities && fullDetails.facilities.length > 0) {
          update.facilities = fullDetails.facilities;
          collectedItems.push(`편의시설 ${fullDetails.facilities.length}개`);
        }

        if (fullDetails.paymentMethods && fullDetails.paymentMethods.length > 0) {
          update.paymentMethods = fullDetails.paymentMethods;
          collectedItems.push(`결제수단 ${fullDetails.paymentMethods.length}개`);
        }

        if (fullDetails.menus && fullDetails.menus.length > 0) {
          update.menus = fullDetails.menus;
          enrichedSummary.menusCount = fullDetails.menus.length;
          if (fullDetails.menus.length !== currentMenus.length) {
            changesSummary.push(`메뉴: ${currentMenus.length}개 ➔ ${fullDetails.menus.length}개 수집`);
          }
          collectedItems.push(`메뉴 ${fullDetails.menus.length}개`);
        }

        if (fullDetails.aiBriefing) {
          update.aiBriefing = fullDetails.aiBriefing;
        }

        if (fullDetails.mainImage) {
          update.mainImage = fullDetails.mainImage;
        }

        steps.push({
          step: "3. 플레이스 상세 크롤링",
          status: "pass",
          message: `크롤링 성공: ${collectedItems.join(", ")}`,
          details: {
            phone: fullDetails.phone,
            businessHours: fullDetails.businessHours ? "수집됨" : "없음",
            menusCount: fullDetails.menus.length,
            facilitiesCount: fullDetails.facilities.length,
          },
        });
      } else {
        steps.push({
          step: "3. 플레이스 상세 크롤링",
          status: "fail",
          message: `Place ID '${placeId}' 상세 페이지 파싱 실패 (내용 없음)`,
        });
      }
    } catch (fullDetailErr) {
      steps.push({
        step: "3. 플레이스 상세 크롤링",
        status: "fail",
        message: `크롤링 중 예외 발생: ${(fullDetailErr as Error).message}`,
      });
    }
  } else {
    steps.push({
      step: "3. 플레이스 상세 크롤링",
      status: "skip",
      message: "Place ID가 없어 네이버 상세 정보 크롤링을 건너뜁니다.",
    });
  }

  // 3. 제로페이 공식 DB (zeropay.or.kr) 교차 검증 (skipZeroPay가 아닐 때만 실행)
  if (!options.skipZeroPay) {
    try {
      const zpTrace = await checkZeroPayOfficialWithTrace(name, address);
      zpTrace.steps.forEach((s) => steps.push(s));

      if (zpTrace.result.isZeroPay) {
        update.isZeroPay = true;
        update.zeroPaySource = "zeropay_official";
        update.zeroPayEnrichedAt = new Date().toISOString();
        if (zpTrace.result.officialName) update.zeroPayOfficialName = zpTrace.result.officialName;
        if (zpTrace.result.officialAddress) update.zeroPayOfficialAddress = zpTrace.result.officialAddress;

        enrichedSummary.isZeroPay = true;
        enrichedSummary.zeroPaySource = "zeropay_official";

        if (!currentZeroPay) {
          changesSummary.push(`제로페이: 미지원 ➔ 지원 (공식상호: '${zpTrace.result.officialName}')`);
        }
      } else {
        if (currentZeroPay) {
          changesSummary.push("제로페이: 지원 ➔ 미지원 변경");
        }
      }
    } catch (zpErr) {
      steps.push({
        step: "4. 제로페이 공식망 교차 검증",
        status: "fail",
        message: `제로페이 조회 예외: ${(zpErr as Error).message}`,
      });
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
          steps.push({
            step: "5. Gemini 카테고리 AI 자동 분류",
            status: "pass",
            message: `AI 분류 성공: '${parsed.label}' (입력업종: '${rawCategory ?? "없음"}')`,
            details: { label: parsed.label },
          });
        }
      }
    }
  } catch (catErr) {
    steps.push({
      step: "5. Gemini 카테고리 AI 분류",
      status: "fail",
      message: `카테고리 분류 예외: ${(catErr as Error).message}`,
    });
  }

  // DB 업데이트 및 캐시 무효화 (saveToDb 옵션이 true일 때만)
  if (options.saveToDb !== false && Object.keys(update).length > 0) {
    await docRef.set(update, { merge: true });
    invalidateRestaurantsCache(companyCode);
  }

  const updatedSnap = await docRef.get();
  const updatedData = updatedSnap.data()!;

  const finalSummary = toRestaurantSummary(restaurantId, updatedData);

  return {
    enrichResult: {
      restaurant: finalSummary,
      enrichedFields: enrichedSummary,
    },
    targetName: name,
    targetAddress: address,
    steps,
    changesSummary,
  };
}

export async function enrichRestaurantById(
  companyCode: string,
  restaurantId: string,
  options: { skipZeroPay?: boolean } = {}
): Promise<EnrichResult> {
  const { enrichResult } = await enrichRestaurantByIdWithTrace(companyCode, restaurantId, options);
  return enrichResult;
}

