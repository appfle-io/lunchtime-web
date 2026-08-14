import crypto from "node:crypto";
import { db } from "@/lib/firebase";
import { getCompanyByCode } from "@/lib/company-server";
import { searchNaverLocal, stripHtmlTags, parseNaverCoords } from "@/lib/naver-local-search";
import { haversineMeters, calculateEstimatedWalkingMeters, calculateWalkingMinutes } from "@/lib/geo";
import type { RestaurantSummary } from "@/types";

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

export function normalizeAddress(addr: string): string {
  if (!addr) return "";
  return addr
    .replace(/서울특별시|서울시|경기도|인천광역시|특별시|광역시/g, "")
    .replace(/[\(\)（）]/g, " ")
    .replace(/[0-9]+층|[0-9]+호|지하[0-9]+층|B[0-9]+층|B[0-9]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 기본 도로명(길/로 + 건물번호)까지만 추출하여 데이터 소스별 층/건물상세 표기 차이를 무시하는 핵심 주소를 반환.
 * 예: "서울특별시 영등포구 문래로 83 아라비즈타워 2층" -> "영등포구 문래로 83"
 */
export function getCoreRoadAddress(addr: string): string {
  const norm = normalizeAddress(addr);
  const match = norm.match(/^(.+?[가-힗]+[구|시|군]\s+[가-힗0-9]+[로|길]\s+[0-9]+(?:-[0-9]+)?)/);
  if (match) {
    return match[1].trim();
  }
  return norm;
}

// 이름+도로명주소 핵심부 기준으로 안정적인(재실행해도 같은) 문서 ID를 만든다 - 중복 생성 방지.
export function makeRestaurantId(name: string, address: string): string {
  const cleanName = normalizeName(name);
  const coreAddr = getCoreRoadAddress(address);
  return crypto.createHash("sha1").update(`${cleanName}|${coreAddr}`).digest("hex").slice(0, 16);
}

// 2026-08-09 신규: scripts/enrich-naver-details.ts(및 최종 버전 enrich-official-final.ts)가
// 이미 Firestore에 저장해두고 있던 phone/businessHours/facilities/paymentMethods/aiBriefing/
// menus/naverPlaceUrl 필드를 listRestaurants()/addRestaurantFromCandidate()가 공통으로
// 읽어오도록 이 헬퍼로 뽑아둔다. (recentReviews는 저작권/개인정보 이슈로 일단 노출 안 함 - 기획
// 문서 참고. mainImage/메뉴사진은 2026-08-09 최종 수집 단계에서 의도적으로 완전히 제거됐으므로
// 이 헬퍼도 더 이상 읽지 않는다 - 옛 enrich 스크립트가 문서에 남겨둔 값이 있어도 무시된다.)
function pickEnrichedFields(data: Record<string, unknown>) {
  return {
    phone: (data.phone as string | null | undefined) ?? null,
    businessHours: data.businessHours ?? null,
    facilities: Array.isArray(data.facilities) ? (data.facilities as string[]) : [],
    paymentMethods: Array.isArray(data.paymentMethods) ? (data.paymentMethods as string[]) : [],
    aiBriefing: (data.aiBriefing as string | null | undefined) ?? null,
    menus: Array.isArray(data.menus) ? (data.menus as RestaurantSummary["menus"]) : [],
    naverPlaceUrl: (data.naverPlaceUrl as string | null | undefined) ?? null,
    discountInfo: data.discountInfo
      ? (data.discountInfo as RestaurantSummary["discountInfo"])
      : null,
  };
}

// 2026-08-10 신규: listRestaurants()는 지도/리스트가 필터링을 위해 매번 "회사의 식당 전체"를
// 필요로 해서(마커를 다 그려야 하니 페이징이 안 맞음) 페이지네이션 대신, 짧은 TTL의 인메모리
// 캐시를 뒀다 - 이 회사 식당 목록은 회사당 1000~1500건 규모라 사람이 새로고침/방문할 때마다
// 매번 전체를 다시 읍으면 사용자수 × 방문횟수만큼 읍기 비용이 그대로 늘어난다. 같은 서버
// 인스턴스가 짧은 시간 안에 여러 요청을 처리하는 동안은 이 캐시로 재사용하고, 식당이 추가/수정
// 되는 시점(addRestaurantFromCandidate, updateRestaurantAdminFields, zeropay-server의
// setZeroPayVote)에 invalidateRestaurantsCache()로 즉시 무효화해서 최신 데이터가 바로 반영되게
// 한다. TTL은 그 사이(다른 서버 인스턴스에서의 쓰기 등)를 대비한 안전망일 뿐이다.
const RESTAURANTS_CACHE_TTL_MS = 30_000;
const restaurantsCache = new Map<string, { data: RestaurantSummary[]; expiresAt: number }>();

export function invalidateRestaurantsCache(companyCode: string): void {
  restaurantsCache.delete(companyCode);
}

export function toRestaurantSummary(id: string, data: Record<string, unknown>): RestaurantSummary {
  const rawName = (data.name as string) ?? "";
  const naverMatchedName = (data.naverMatchedName as string | null | undefined) ?? null;
  const zeroPayOfficialName = (data.zeroPayOfficialName as string | null | undefined) ?? null;
  const businessName = (data.businessName as string | null | undefined) ?? (data.originalName as string | null | undefined) ?? rawName;

  // 메인 화면 표시 상호명: naverMatchedName이 존재하면 최우선 사용, 없으면 원본 상호명
  const displayName = naverMatchedName || rawName;

  const distanceMeters = typeof data.distanceMeters === "number" ? data.distanceMeters : undefined;
  const walkingMeters = typeof distanceMeters === "number" ? calculateEstimatedWalkingMeters(distanceMeters) : undefined;
  const walkingMinutes = typeof walkingMeters === "number" ? calculateWalkingMinutes(walkingMeters) : undefined;

  return {
    id,
    name: displayName, // 기존 UI 호환성 보장
    displayName,
    zeroPayOfficialName,
    businessName,
    naverMatchedName,
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    category: data.category ?? null,
    // 2026-08-07 신규: AI 재분류 결과 (scripts/classify-categories-ai.ts). 없으면 null.
    categoryLabel: data.categoryLabel ?? null,
    isZeroPay: Boolean(data.isZeroPay),
    // 2026-08-06 신규: 제로페이 엄지척 투표에서 계산되어 캐시된 값 (lib/zeropay-server.ts 참고).
    isZeroPayNeedsReview: Boolean(data.isZeroPayNeedsReview),
    distanceMeters,
    walkingMeters,
    walkingMinutes,
    // 2026-08-09 신규: scripts/enrich-naver-details.ts 수집분(전화/영업시간/메뉴 등) 노출.
    ...pickEnrichedFields(data),
    // 2026-08-10 신규: 관리자 페이지 "사용여부". 필드가 없는(기존) 문서는 true로 취급 -
    // 그래야 지금까지 등록된 1000+건이 마이그레이션 없이 전부 "사용중"으로 보인다.
    isActive: data.isActive !== false,
  } as RestaurantSummary;
}

// 2026-08-11 신규(RestaurantDetail 재오픈 캐시 개선): 식당 문서에서 lastActivityAt 필드 하나만
// 확인한다(리뷰/제로페이 투표 아무거나 있으면 갱신되는 필드 - review-server.ts addReview,
// zeropay-server.ts setZeroPayVote 참고). 문서 1건 읍기라 저렴하고, 이 값이 클라이언트가 캐시해둔
// 값과 같으면 reviews/제로페이 전체를 다시 안 불러와도 된다는 뜻이다.
export async function getRestaurantActivity(
  companyCode: string,
  restaurantId: string
): Promise<string | null> {
  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants")
    .doc(restaurantId)
    .get();
  return (snapshot.data()?.lastActivityAt as string | undefined) ?? null;
}

// companies/{code}/restaurants 서브컬렉션 전체를 읽어온다. 서버(Server Component / API route)에서만 사용.
export async function listRestaurants(companyCode: string): Promise<RestaurantSummary[]> {
  const cached = restaurantsCache.get(companyCode);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants")
    .get();

  const restaurants = snapshot.docs.map((doc) => toRestaurantSummary(doc.id, doc.data()));
  restaurantsCache.set(companyCode, { data: restaurants, expiresAt: Date.now() + RESTAURANTS_CACHE_TTL_MS });
  return restaurants;
}

export interface DuplicateWarning {
  /** 유사한 기존 가맹점 */
  similarRestaurant: { id: string; name: string; address: string; distanceMeters: number };
  /** 이름 유사도 (0~1) */
  similarity: number;
}

export interface AddRestaurantResult {
  restaurant: RestaurantSummary;
  existing: boolean; // true면 이미 있던 식당이라 새로 만들지 않고 기존 항목을 그대로 반환한 것
  /** 비슷한 가맹점이 이미 DB에 있을 때 설정 (등록은 그대로 진행되지만 프론트에서 경고 표시용) */
  duplicateWarning?: DuplicateWarning;
}

export interface RestaurantCandidate {
  title: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  distanceMeters: number; // 회사 중심좌표로부터의 거리(반올림, m)
}

// 2026-08-06 개편 (5차 → "직접 추가" 2단계 방식으로 전면 변경):
// 예전엔 이름(+주소힌트)으로 후보를 하나 자동으로 골라서 바로 저장했는데("addRestaurantManually"),
// "궁중삼계탕" 사례에서 여러 차례(거리검증/정렬방식/랜드마크 앵커) 고쳐도 계속 실패했다.
// 사용자 제안: "사업자가 업종을 다르게 등록해뒀을 수 있으니, 후보 목록(상호명+주소)을 보여주고
// 사용자가 직접 고르게 하자" — 이게 훨씬 근본적인 해결책이라 채택함. 자동 매칭(1개 확정) 대신
// "후보 검색 → 사용자가 선택 → 그 선택 그대로 저장" 2단계로 바꿨다.
//
// 그래서 isFoodRelatedCategory 필터를 여기서는 일부러 안 쓴다 - 네이버 카테고리가 "도소매"처럼
// 엉뚱하게 등록된 실제 식당이 있을 수 있는데, 자동으로 걸러버리면 그 후보 자체가 안 보이게 된다.
// 카테고리 텍스트는 그대로 후보 목록에 같이 보여줘서 사용자가 판단하게 한다.
//
// 거리 상한(구 MAX_MANUAL_ADD_DISTANCE_METERS)도 더 이상 "거부" 용도로 안 쓰고, 프론트엔드에서
// "회사에서 좀 멀어요" 같은 경고 배지 표시용 참고값으로만 쓴다 - 최종 판단은 사용자가 주소를 보고 내린다.
export async function searchRestaurantCandidates(
  companyCode: string,
  name: string,
  addressHint?: string
): Promise<RestaurantCandidate[]> {
  const company = await getCompanyByCode(companyCode);
  if (!company) {
    throw new Error(`companies/${companyCode} 문서를 찾을 수 없습니다.`);
  }

  // 검색어 후보: (이름+주소힌트) → (구/동+이름) → (landmark+이름, landmark마다 하나씩) → (이름 단독).
  // landmark는 자동 시딩 스크립트에서 이미 검증된 "네이버가 잘 인식하는 구체적 장소명"이라
  // districtCode 하나보다 훨씬 좁고 정확한 위치 앵커 역할을 한다.
  const queries = [
    addressHint ? `${name} ${addressHint}` : null,
    `${company.districtCode ?? ""} ${name}`.trim(),
    ...(company.landmarks ?? []).map((landmark) => `${landmark} ${name}`),
    name,
  ].filter((q): q is string => Boolean(q));

  const candidates = new Map<string, RestaurantCandidate>();

  for (const query of queries) {
    let items;
    try {
      // sort="random"(정확도순): 검색어 텍스트와의 관련도 기준. "comment"(리뷰순)를 쓰면 검색어와
      // 무관하게 리뷰 많은 타지역 지점이 상위로 잡혀서 회사 근처 후보 자체가 안 보일 수 있었다.
      items = await searchNaverLocal(query, 5, "random");
    } catch {
      continue; // 검색어 하나가 실패해도(네트워크 등) 나머지 검색어는 계속 시도
    }

    for (const item of items) {
      const { lat, lng } = parseNaverCoords(item);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const title = stripHtmlTags(item.title);
      const address = item.roadAddress || item.address;
      const key = `${title}|${address}`;
      if (candidates.has(key)) continue; // 이미 다른 검색어에서 잡힌 동일 장소는 중복 제외

      const category = item.category ? stripHtmlTags(item.category) : null;
      const distanceMeters = haversineMeters(company.centerLat, company.centerLng, lat, lng);

      candidates.set(key, {
        title,
        address,
        lat,
        lng,
        category,
        distanceMeters: Math.round(distanceMeters),
      });
    }
  }

  // 회사에서 가까운 순으로 정렬하고, 고르기 너무 힘들지 않도록 상위 10곳까지만 반환.
  return Array.from(candidates.values())
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 10);
}

// "직접 추가" 2단계 플로우의 2단계: 사용자가 searchRestaurantCandidates 결과 중 직접 고른 후보를
// 검증 없이 그대로 저장한다(사용자가 이미 상호명+주소를 보고 확인했으므로). 이미 같은 식당(같은 id)이
// 있으면 새로 만들지 않고 existing:true로 기존 데이터를 돌려준다.
// ── 내부 헬퍼: 이름 유사도 (자카드) ─────────────────────────────
function nameSimilarity(a: string, b: string): number {
  const sa = new Set(a.replace(/\s/g, "").split(""));
  const sb = new Set(b.replace(/\s/g, "").split(""));
  const intersection = [...sa].filter((c) => sb.has(c)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : intersection / union;
}

export async function addRestaurantFromCandidate(
  companyCode: string,
  candidate: { title: string; address: string; lat: number; lng: number; category: string | null }
): Promise<AddRestaurantResult> {
  const company = await getCompanyByCode(companyCode);
  if (!company) {
    throw new Error(`companies/${companyCode} 문서를 찾을 수 없습니다.`);
  }

  const id = makeRestaurantId(candidate.title, candidate.address);
  const docRef = db.collection("companies").doc(companyCode).collection("restaurants").doc(id);

  const existingSnapshot = await docRef.get();
  if (existingSnapshot.exists) {
    // 2026-08-10: toRestaurantSummary()로 통일 - 이미 있던 식당이면 enrich 스크립트가 채워둔 값과
    // isActive 기본값(true)까지 listRestaurants()와 동일한 규칙으로 같이 반환된다.
    return { existing: true, restaurant: toRestaurantSummary(id, existingSnapshot.data()!) };
  }

  const distanceMeters = Math.round(
    haversineMeters(company.centerLat, company.centerLng, candidate.lat, candidate.lng)
  );

  // ── 중복 체크: 이미 DB에 비슷한 가맹점이 있는지 확인 ──────────────
  // 이름 유사도 75% 이상 + 직선거리 100m 이내인 기존 가맹점이 있으면 경고.
  // 등록 자체는 계속 진행하되, 프론트에서 "혹시 이 가맹점이랑 같은 곳 아닌가요?" 경고 표시용.
  let duplicateWarning: DuplicateWarning | undefined;
  try {
    // 2026-08-10 수정: 별도로 컬렉션 전체를 다시 읍지 않고 listRestaurants()(캐시 적용)를 재사용한다 -
    // 어차피 같은 회사의 식당 전체가 필요하므로, 캐시가 살아있으면 등록 1건당 추가 Firestore 읍기가
    // 0이 된다.
    const allRestaurants = await listRestaurants(companyCode);
    for (const r of allRestaurants) {
      if (r.id === id) continue;
      const sim = nameSimilarity(candidate.title, r.name ?? "");
      if (sim < 0.75) continue;
      const dist = haversineMeters(candidate.lat, candidate.lng, r.lat as number, r.lng as number);
      if (dist <= 100) {
        duplicateWarning = {
          similarRestaurant: {
            id: r.id,
            name: r.name,
            address: r.address,
            distanceMeters: Math.round(dist),
          },
          similarity: Math.round(sim * 100) / 100,
        };
        break; // 첫 번째 발견된 유사 가맹점만 반환
      }
    }
  } catch {
    // 중복 체크 실패는 무시하고 등록 계속 진행
  }

  const restaurant = {
    name: candidate.title,
    address: candidate.address,
    lat: candidate.lat,
    lng: candidate.lng,
    category: candidate.category,
    isZeroPay: false, // 제로페이 엄지척 투표로 추후 true로 바뀔 수 있음 (lib/zeropay-server.ts)
    isZeroPayNeedsReview: false,
    distanceMeters,
    source: "manual" as const,
    addedAt: new Date().toISOString(),
  };

  await docRef.set(restaurant);
  invalidateRestaurantsCache(companyCode); // 새로 추가된 식당이 지도/리스트에 바로 보이도록 캐시 무효화

  // 2026-08-10: toRestaurantSummary()로 통일 - 방금 만든 restaurant 객체엔 phone/menus 등 enrich
  // 필드가 아직 없는데, pickEnrichedFields()가 그대로 null/[] 기본값을 채워주고 isActive도
  // 자동으로 true가 된다 (listRestaurants()/기존 식당 조회와 동일한 로직).
  return { existing: false, duplicateWarning, restaurant: toRestaurantSummary(id, restaurant) };
}

// 2026-08-09 신규: 관리자 페이지에서 가맹점 정보를 직접 수정할 때 쓰는 범용 업데이트 함수.
// 전부 선택 필드라 바뀐 값만 보내면 되고(전체를 다 보내지 않아도 됨), Firestore의 set(merge:true)를
// 써서 안 보낸 필드는 건드리지 않는다. businessHours는 원본이 복잡한 구조라 관리자 페이지에서는
// 그냥 사람이 읽을 수 있는 문자열 하나로 단순화해서 덮어쓴다 - 다음 자동 enrich가 다시 돌면
// 원래(복잡한) 구조로 되돌아갈 수 있다는 점은 감안해야 한다.
export interface RestaurantAdminUpdate {
  name?: string;
  businessName?: string | null;
  zeroPayOfficialName?: string | null;
  naverMatchedName?: string | null;
  address?: string;
  category?: string | null;
  categoryLabel?: string | null;
  phone?: string | null;
  businessHours?: string | null;
  facilities?: string[];
  paymentMethods?: string[];
  aiBriefing?: string | null;
  menus?: RestaurantSummary["menus"];
  naverPlaceUrl?: string | null;
  discountInfo?: RestaurantSummary["discountInfo"];
  isZeroPay?: boolean;
  // 2026-08-10 신규: 관리자 페이지 "사용여부" 토글 저장용. false를 보내면 N 처리(메인 화면 제외).
  isActive?: boolean;
}

export async function updateRestaurantAdminFields(
  companyCode: string,
  restaurantId: string,
  update: RestaurantAdminUpdate
): Promise<RestaurantSummary> {
  const docRef = db.collection("companies").doc(companyCode).collection("restaurants").doc(restaurantId);
  await docRef.set(update, { merge: true });
  invalidateRestaurantsCache(companyCode); // 수정된 내용이 지도/리스트에 바로 보이도록 캐시 무효화
  const snapshot = await docRef.get();
  return toRestaurantSummary(restaurantId, snapshot.data()!);
}
