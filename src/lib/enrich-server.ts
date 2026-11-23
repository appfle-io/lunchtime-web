import { db } from "@/lib/firebase";
import { invalidateRestaurantsCache, toRestaurantSummary } from "@/lib/restaurant-server";
import {
  findVerifiedNaverPlace,
  naverClearFields,
  naverFieldsFromDetails,
  naverMatchFailFields,
} from "@/lib/naver-verify";
import { checkZeroPayOfficialWithTrace, type TraceStep, type ZeroPayOfficialCheckResult } from "@/lib/zeropay-official";

/**
 * 제로페이 공식 판정 결과를 식당 문서 필드로 바꾼다. 판정 기록(status/시각/후보)은 항상 남기고,
 * isZeroPay 자체는 confirmed일 때만 true로 바꾼다. 관리자가 수동으로 정한 곳(zeroPaySource: "manual")은
 * 기록만 남기고 isZeroPay를 건드리지 않는다. not_found/review/error는 여기서 false로 내리지 않는다 -
 * 내리는 건 관리자 점검 화면에서 확인 후에만 한다.
 */
export function zeroPayCheckFields(
  result: ZeroPayOfficialCheckResult,
  current: { isZeroPay: boolean; zeroPaySource?: string | null }
): Record<string, unknown> {
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {
    zeroPayCheckStatus: result.status,
    zeroPayCheckMessage: result.message,
    zeroPayCheckedAt: now,
    zeroPayReviewCandidates:
      result.status === "review"
        ? (result.candidates ?? []).slice(0, 5).map((c) => ({
            name: c.name,
            address: c.address,
            bizType: c.bizType,
            reason: c.reason,
          }))
        : [],
  };
  if (result.status === "confirmed") {
    fields.zeroPayOfficialName = result.officialName ?? null;
    fields.zeroPayOfficialAddress = result.officialAddress ?? null;
    fields.zeroPayOfficialPhone = result.officialPhone ?? null;
    fields.zeroPayRecentTransaction = Boolean(result.recentTransaction);
    if (current.zeroPaySource !== "manual") {
      fields.isZeroPay = true;
      fields.zeroPaySource = "official_zeropay_api";
      fields.zeroPayEnrichedAt = now;
    }
  }
  return fields;
}
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
    naverMatchStatus?: string;
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

  // 1~2. 네이버 플레이스 확인 및 상세 정보 수집.
  // 상호·주소를 비교해 같은 가게로 확인된 플레이스만 반영한다 (naver-verify.ts, naver-match.ts).
  try {
    const naver = await findVerifiedNaverPlace(
      {
        name,
        address,
        naverPlaceId: existingPlaceId || null,
        naverPlaceUrl: existingPlaceUrl || null,
        naverMatchStatus: (storeData.naverMatchStatus as string | undefined) ?? null,
      },
      { districtKeyword, steps }
    );
    enrichedSummary.naverMatchStatus = naver.status ?? undefined;

    if (naver.details && (naver.status === "verified" || naver.status === "manual")) {
      const details = naver.details;
      // 붙어 있던 플레이스가 다른 가게였다면 그 가게에서 온 정보(영업시간 등)가 남지 않게 먼저 비운다.
      if (naver.existingRejected) {
        Object.assign(update, naverClearFields(naver.reason));
        changesSummary.push(`네이버: 다른 가게 정보 교체 ('${storeData.naverMatchedName ?? existingPlaceId}' → '${details.matchedName}')`);
      }
      Object.assign(update, naverFieldsFromDetails(details, naver.status, naver.reason));
      enrichedSummary.naverPlaceId = details.naverPlaceId;
      enrichedSummary.naverPlaceUrl = details.naverPlaceUrl;

      if (details.phone) {
        enrichedSummary.phone = details.phone;
        if (details.phone !== currentPhone) {
          changesSummary.push(`전화번호: ${currentPhone ?? "(없음)"} → ${details.phone}`);
        }
      }
      if (details.menus.length > 0) {
        enrichedSummary.menusCount = details.menus.length;
        if (details.menus.length !== currentMenus.length) {
          changesSummary.push(`메뉴: ${currentMenus.length}개 → ${details.menus.length}개 수집`);
        }
      }
      if (existingPlaceId && existingPlaceId !== details.naverPlaceId && !naver.existingRejected) {
        changesSummary.push(`네이버 플레이스: ${existingPlaceId} → ${details.naverPlaceId}`);
      }
    } else if (naver.status === "mismatch" || naver.status === "not_found") {
      // 같은 가게를 못 찾으면 아무것도 반영하지 않고 판정 기록만 남긴다. 기존 정보 삭제는 관리자 점검에서만.
      Object.assign(update, naverMatchFailFields(naver.status, naver.reason));
      if (naver.status === "mismatch") {
        changesSummary.push(`네이버: 붙어 있는 정보가 다른 가게로 보임 - ${naver.reason}`);
      }
    }
  } catch (naverErr) {
    steps.push({
      step: "네이버 플레이스 확인",
      status: "fail",
      message: `네이버 조회 예외: ${(naverErr as Error).message}`,
    });
  }

  // 3. 제로페이 공식 DB (zeropay.or.kr) 교차 검증 (skipZeroPay가 아닐 때만 실행)
  if (!options.skipZeroPay) {
    try {
      const zpTrace = await checkZeroPayOfficialWithTrace({
        name,
        address,
        phone: "phone" in update ? (update.phone as string | null) : currentPhone, // 다른 가게 전화번호를 지운 경우 그 번호로 대조하지 않는다
      });
      zpTrace.steps.forEach((s) => steps.push(s));

      const zpFields = zeroPayCheckFields(zpTrace.result, {
        isZeroPay: currentZeroPay,
        zeroPaySource: (storeData.zeroPaySource as string | undefined) ?? null,
      });
      Object.assign(update, zpFields);

      if (zpFields.isZeroPay === true) {
        enrichedSummary.isZeroPay = true;
        enrichedSummary.zeroPaySource = "official_zeropay_api";
        if (!currentZeroPay) {
          changesSummary.push(`제로페이: 미지원 → 지원 (공식 등록명: '${zpTrace.result.officialName}')`);
        }
      } else if (zpTrace.result.status === "review") {
        changesSummary.push(`제로페이: 관리자 확인 필요 - ${zpTrace.result.message}`);
      } else if (zpTrace.result.status === "not_found" && currentZeroPay) {
        changesSummary.push("제로페이: 공식 사이트에서 찾지 못함 (값은 유지, 관리자 점검에서 확인 필요)");
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
  let finalSummary;
  if (options.saveToDb !== false) {
    if (Object.keys(update).length > 0) {
      await docRef.set(update, { merge: true });
      await invalidateRestaurantsCache(companyCode, [restaurantId]);
    }
    const updatedSnap = await docRef.get();
    finalSummary = toRestaurantSummary(restaurantId, updatedSnap.data()!);
  } else {
    // 점검(미저장) 모드: DB를 다시 읽으면 기존 값이 나오므로, 기존 값 + 새로 수집한 값을 합쳐서 돌려준다.
    // (예전엔 여기서 DB를 다시 읽어서 네이버 점검 화면의 "변경 예정" 값이 기존 값 그대로였다)
    finalSummary = toRestaurantSummary(restaurantId, { ...storeData, ...update });
  }

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

