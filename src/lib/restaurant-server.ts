import crypto from "node:crypto";
import { db } from "@/lib/firebase";
import { getCompanyByCode } from "@/lib/company-server";
import { searchNaverLocal, stripHtmlTags, parseNaverCoords } from "@/lib/naver-local-search";
import { haversineMeters } from "@/lib/geo";
import type { RestaurantSummary } from "@/types";

// 이름+도로명주소 기준으로 안정적인(재실행해도 같은) 문서 ID를 만든다 - 중복 생성 방지.
export function makeRestaurantId(name: string, address: string): string {
  return crypto.createHash("sha1").update(`${name}|${address}`).digest("hex").slice(0, 16);
}

// companies/{code}/restaurants 서브컬렉션 전체를 읽어온다. 서버(Server Component / API route)에서만 사용.
export async function listRestaurants(companyCode: string): Promise<RestaurantSummary[]> {
  const snapshot = await db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      address: data.address,
      lat: data.lat,
      lng: data.lng,
      category: data.category ?? null,
      // 2026-08-07 신규: AI 재분류 결과 (scripts/classify-categories-ai.ts). 없으면 null.
      categoryLabel: data.categoryLabel ?? null,
      isZeroPay: Boolean(data.isZeroPay),
      // 2026-08-06 신규: 제로페이 엄지척 투표에서 계산되어 캐시된 값 (lib/zeropay-server.ts 참고).
      isZeroPayNeedsReview: Boolean(data.isZeroPayNeedsReview),
      distanceMeters: data.distanceMeters,
    };
  });
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
    const data = existingSnapshot.data()!;
    return {
      existing: true,
      restaurant: {
        id,
        name: data.name,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        category: data.category ?? null,
        categoryLabel: data.categoryLabel ?? null,
        isZeroPay: Boolean(data.isZeroPay),
        isZeroPayNeedsReview: Boolean(data.isZeroPayNeedsReview),
        distanceMeters: data.distanceMeters,
      },
    };
  }

  const distanceMeters = Math.round(
    haversineMeters(company.centerLat, company.centerLng, candidate.lat, candidate.lng)
  );

  // ── 중복 체크: 이미 DB에 비슷한 가맹점이 있는지 확인 ──────────────
  // 이름 유사도 75% 이상 + 직선거리 100m 이내인 기존 가맹점이 있으면 경고.
  // 등록 자체는 계속 진행하되, 프론트에서 "혹시 이 가맹점이랑 같은 곳 아닌가요?" 경고 표시용.
  let duplicateWarning: DuplicateWarning | undefined;
  try {
    const allSnap = await db.collection("companies").doc(companyCode).collection("restaurants").get();
    for (const doc of allSnap.docs) {
      if (doc.id === id) continue;
      const d = doc.data();
      const sim = nameSimilarity(candidate.title, (d.name as string) ?? "");
      if (sim < 0.75) continue;
      const dist = haversineMeters(candidate.lat, candidate.lng, d.lat as number, d.lng as number);
      if (dist <= 100) {
        duplicateWarning = {
          similarRestaurant: {
            id: doc.id,
            name: d.name as string,
            address: d.address as string,
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

  return {
    existing: false,
    duplicateWarning,
    restaurant: {
      id,
      name: restaurant.name,
      address: restaurant.address,
      lat: restaurant.lat,
      lng: restaurant.lng,
      category: restaurant.category,
      categoryLabel: null,
      isZeroPay: restaurant.isZeroPay,
      isZeroPayNeedsReview: restaurant.isZeroPayNeedsReview,
      distanceMeters: restaurant.distanceMeters,
    },
  };
}

