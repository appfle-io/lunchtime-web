import {
  fetchNaverPlaceFullDetails,
  resolveNaverPlaceId,
  searchNaverPlaceCandidates,
  type NaverPlaceFullDetails,
} from "@/lib/naver-place-detail";
import { judgeNaverPlaceMatch, type NaverMatchVerdict } from "@/lib/naver-match";
import type { TraceStep } from "@/lib/zeropay-official";

/**
 * 식당 문서의 네이버 매칭 상태 (`naverMatchStatus`).
 * - verified: 상호·주소를 비교해 같은 가게로 확인한 플레이스
 * - manual: 관리자가 네이버 지도 링크를 직접 넣은 플레이스 (비교 없이 믿는다)
 * - mismatch: 붙어 있던 플레이스가 다른 가게로 판정됐고, 대신 쓸 플레이스도 못 찾음
 * - not_found: 검색 후보 중 같은 가게가 없음
 * 값이 없으면 이 검증이 생기기 전(2026-11 이전)에 붙은 매칭이다.
 */
export type NaverMatchStatus = "verified" | "manual" | "mismatch" | "not_found";

// 한 식당에서 확인할 검색 후보 수. 후보마다 네이버 상세 페이지 요청이 1번씩 생긴다.
const MAX_SEARCH_CANDIDATES = 3;

export interface NaverStoreInput {
  name: string;
  address: string;
  naverPlaceId?: string | null;
  naverPlaceUrl?: string | null;
  naverMatchStatus?: string | null;
}

export interface VerifiedNaverPlaceResult {
  /** 같은 가게로 확인된(또는 관리자가 지정한) 플레이스 상세. 없으면 null */
  details: NaverPlaceFullDetails | null;
  status: NaverMatchStatus | null; // null: 네트워크 오류 등으로 판단 못 함 (기록을 바꾸지 않는다)
  reason: string;
  /** 문서에 이미 붙어 있던 플레이스가 다른 가게로 판정됐는지 */
  existingRejected: boolean;
}

/**
 * DB 식당에 맞는 네이버 플레이스를 찾는다. 기존 플레이스 ID가 있으면 먼저 확인하고,
 * 다른 가게로 판정되면 검색 후보를 차례로 확인한다. 같은 가게로 판정된 것만 돌려준다.
 */
export async function findVerifiedNaverPlace(
  store: NaverStoreInput,
  options: { districtKeyword?: string; steps: TraceStep[] }
): Promise<VerifiedNaverPlaceResult> {
  const { steps } = options;
  const dbPlace = { name: store.name, address: store.address };
  const existingId = store.naverPlaceId || (store.naverPlaceUrl ? await resolveNaverPlaceId(store.naverPlaceUrl) : null);
  let existingRejected = false;
  let lastReason = "";

  if (existingId) {
    const details = await fetchNaverPlaceFullDetails(existingId);
    if (!details) {
      steps.push({
        step: "네이버 플레이스 확인",
        status: "fail",
        message: `등록된 플레이스 '${existingId}' 상세를 불러오지 못했습니다 (기존 정보 유지).`,
      });
      return { details: null, status: null, reason: "네이버 상세 조회 실패", existingRejected: false };
    }
    if (store.naverMatchStatus === "manual") {
      steps.push({
        step: "네이버 플레이스 확인",
        status: "pass",
        message: `관리자가 지정한 플레이스 '${details.matchedName}' (${details.matchedAddress}) - 비교 없이 반영`,
        details: { placeId: existingId },
      });
      return { details, status: "manual", reason: "관리자 지정", existingRejected: false };
    }
    const judged = judgeNaverPlaceMatch(dbPlace, { name: details.matchedName, address: details.matchedAddress });
    steps.push(matchStep("등록된 플레이스 확인", existingId, details, judged.verdict, judged.reason));
    if (judged.verdict === "match") {
      return { details, status: "verified", reason: judged.reason, existingRejected: false };
    }
    existingRejected = judged.verdict === "mismatch";
    lastReason = `등록된 플레이스 '${details.matchedName}': ${judged.reason}`;
  }

  const candidates = (
    await searchNaverPlaceCandidates(store.name, {
      districtKeyword: options.districtKeyword,
      limit: MAX_SEARCH_CANDIDATES,
    })
  ).filter((c) => c.naverPlaceId !== existingId);

  if (candidates.length === 0) {
    steps.push({ step: "네이버 검색", status: "fail", message: `'${store.name}' 검색 후보가 없습니다.` });
  }

  for (const c of candidates) {
    // 지도 검색은 이름/주소를 같이 준다. 이것만으로 다른 가게가 확실하면 상세 요청을 아낀다.
    if (c.matchedName && c.matchedAddress) {
      const pre = judgeNaverPlaceMatch(dbPlace, { name: c.matchedName, address: c.matchedAddress });
      if (pre.verdict === "mismatch") {
        steps.push({
          step: "검색 후보 확인",
          status: "skip",
          message: `'${c.matchedName}' (${c.matchedAddress}) 다른 가게: ${pre.reason}`,
        });
        lastReason = lastReason || `검색 후보 '${c.matchedName}': ${pre.reason}`;
        continue;
      }
    }
    const details = await fetchNaverPlaceFullDetails(c.naverPlaceId);
    if (!details) {
      steps.push({ step: "검색 후보 확인", status: "fail", message: `후보 '${c.naverPlaceId}' 상세 조회 실패` });
      continue;
    }
    const judged = judgeNaverPlaceMatch(dbPlace, { name: details.matchedName, address: details.matchedAddress });
    steps.push(matchStep("검색 후보 확인", c.naverPlaceId, details, judged.verdict, judged.reason));
    if (judged.verdict === "match") {
      return { details, status: "verified", reason: judged.reason, existingRejected };
    }
    lastReason = lastReason || `검색 후보 '${details.matchedName}': ${judged.reason}`;
  }

  return {
    details: null,
    status: existingRejected ? "mismatch" : "not_found",
    reason: lastReason || "같은 가게로 확인된 네이버 플레이스 없음",
    existingRejected,
  };
}

function matchStep(
  step: string,
  placeId: string,
  details: NaverPlaceFullDetails,
  verdict: NaverMatchVerdict,
  reason: string
): TraceStep {
  return {
    step,
    status: verdict === "match" ? "pass" : "fail",
    message: `'${details.matchedName}' (${details.matchedAddress || "주소 없음"}) ${verdict === "match" ? "같은 가게" : "반영 안 함"}: ${reason}`,
    details: { placeId, verdict },
  };
}

/** 확인된 플레이스 상세를 식당 문서 필드로 바꾼다. 비어 있는 항목은 기존 값을 지우지 않게 넣지 않는다. */
export function naverFieldsFromDetails(
  details: NaverPlaceFullDetails,
  status: "verified" | "manual",
  reason: string
): Record<string, unknown> {
  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {
    naverPlaceId: details.naverPlaceId,
    naverPlaceUrl: details.naverPlaceUrl,
    naverMatchedName: details.matchedName || null,
    naverMatchedAddress: details.matchedAddress || null,
    naverMatchStatus: status,
    naverMatchReason: reason,
    naverMatchCheckedAt: now,
    naverEnrichedAt: now,
  };
  if (details.phone) fields.phone = details.phone;
  if (details.businessHours) fields.businessHours = details.businessHours;
  if (details.facilities.length > 0) fields.facilities = details.facilities;
  if (details.paymentMethods.length > 0) fields.paymentMethods = details.paymentMethods;
  if (details.menus.length > 0) fields.menus = details.menus;
  if (details.aiBriefing) fields.aiBriefing = details.aiBriefing;
  if (details.mainImage) fields.mainImage = details.mainImage;
  return fields;
}

/** 같은 가게를 못 찾았을 때 남기는 기록. 기존 정보는 지우지 않는다 (지우는 건 관리자 점검에서 체크한 것만). */
export function naverMatchFailFields(status: "mismatch" | "not_found", reason: string): Record<string, unknown> {
  return {
    naverMatchStatus: status,
    naverMatchReason: reason,
    naverMatchCheckedAt: new Date().toISOString(),
  };
}

/** 다른 가게에서 가져온 네이버 정보를 지우는 패치 (관리자 점검 화면에서 체크한 곳만 반영). */
export function naverClearFields(reason: string): Record<string, unknown> {
  return {
    naverPlaceId: null,
    naverPlaceUrl: null,
    naverMatchedName: null,
    naverMatchedAddress: null,
    phone: null,
    businessHours: null,
    facilities: [],
    paymentMethods: [],
    menus: [],
    aiBriefing: null,
    mainImage: null,
    ...naverMatchFailFields("mismatch", reason),
  };
}
