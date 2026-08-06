import crypto from "node:crypto";
import { db } from "@/lib/firebase";
import { getCompanyByCode } from "@/lib/company-server";
import { searchNaverLocal, stripHtmlTags, parseNaverCoords } from "@/lib/naver-local-search";
import { isFoodRelatedCategory } from "@/lib/restaurant-category";
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
      isZeroPay: Boolean(data.isZeroPay),
      distanceMeters: data.distanceMeters,
    };
  });
}

export interface AddRestaurantResult {
  restaurant: RestaurantSummary;
  existing: boolean; // true면 이미 있던 식당이라 새로 만들지 않고 기존 항목을 그대로 반환한 것
}

// 자동 시딩에서 빠진 식당을 사용자가 직접 추가할 때 쓴다.
// name(+선택적 addressHint)으로 네이버 지역검색을 돌려서 가장 위 결과를 매칭한 뒤,
// 이미 같은 식당(같은 id)이 있으면 새로 만들지 않고 existing:true로 기존 데이터를 돌려준다.
// 매칭 결과가 음식점/카페 카테고리가 아니면(자전거 대여소, 병원 등) 그 결과는 버리고 다음 검색어로 넘어간다.
// 끝까지 못 찾으면 에러를 던지니, 호출하는 쪽(API route)에서 사용자에게 다른 검색어를 안내해야 한다.
export async function addRestaurantManually(
  companyCode: string,
  name: string,
  addressHint?: string
): Promise<AddRestaurantResult> {
  const company = await getCompanyByCode(companyCode);
  if (!company) {
    throw new Error(`companies/${companyCode} 문서를 찾을 수 없습니다.`);
  }

  const queries = [
    addressHint ? `${name} ${addressHint}` : null,
    `${company.districtCode ?? ""} ${name}`.trim(),
    name,
  ].filter((q): q is string => Boolean(q));

  let matched: { title: string; address: string; lat: number; lng: number; category: string | null } | null =
    null;
  let sawNonFoodMatch = false;

  for (const query of queries) {
    const items = await searchNaverLocal(query, 1);
    if (items.length === 0) continue;
    const item = items[0];
    const { lat, lng } = parseNaverCoords(item);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    const category = item.category ? stripHtmlTags(item.category) : null;
    if (!isFoodRelatedCategory(category)) {
      sawNonFoodMatch = true;
      continue; // 음식점/카페가 아니면 이 결과는 버리고 다음 검색어로 시도
    }

    matched = {
      title: stripHtmlTags(item.title),
      address: item.roadAddress || item.address,
      lat,
      lng,
      category,
    };
    break;
  }

  if (!matched) {
    if (sawNonFoodMatch) {
      throw new Error(
        `"${name}"은 음식점/카페로 보이지 않는 곳으로만 찾아졌어요. 상호명/지점명을 더 정확히 입력해서 다시 시도해주세요.`
      );
    }
    throw new Error(
      `"${name}"을 네이버 지역검색에서 찾지 못했어요. 정확한 상호명이나 지점명을 포함해서 다시 시도해주세요.`
    );
  }

  const id = makeRestaurantId(matched.title, matched.address);
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
        isZeroPay: Boolean(data.isZeroPay),
        distanceMeters: data.distanceMeters,
      },
    };
  }

  const distanceMeters = Math.round(
    haversineMeters(company.centerLat, company.centerLng, matched.lat, matched.lng)
  );

  const restaurant = {
    name: matched.title,
    address: matched.address,
    lat: matched.lat,
    lng: matched.lng,
    category: matched.category,
    isZeroPay: false, // TODO: 제로페이 공공데이터 매칭/사내 투표로 추후 갱신
    distanceMeters,
    source: "manual" as const,
    addedAt: new Date().toISOString(),
  };

  await docRef.set(restaurant);

  return {
    existing: false,
    restaurant: {
      id,
      name: restaurant.name,
      address: restaurant.address,
      lat: restaurant.lat,
      lng: restaurant.lng,
      category: restaurant.category,
      isZeroPay: restaurant.isZeroPay,
      distanceMeters: restaurant.distanceMeters,
    },
  };
}
