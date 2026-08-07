import type { RestaurantSummary } from "@/types";
import { getCategoryVisual, isGroupDiningFriendly, isSummerSpecialty } from "@/lib/restaurant-category";

// 필터바(FilterBar)의 "특수 태그" 종류. 카테고리 태그(한식/중식/...)는 데이터에서 동적으로 뽑아내므로
// 여기엔 카테고리가 아닌 것만 정의한다.
export type SpecialFilterKey =
  | "zeropay"
  | "walk5"
  | "favorite"
  | "groupdining"
  | "recentlyPopular"
  | "summer";

export const SPECIAL_FILTERS: { key: SpecialFilterKey; label: string }[] = [
  { key: "zeropay", label: "제로페이" },
  { key: "walk5", label: "도보 5분" },
  { key: "favorite", label: "즐겨찾기" },
  { key: "groupdining", label: "회식" },
  { key: "recentlyPopular", label: "최근많이찾는" },
  { key: "summer", label: "여름별미" },
];

// popularIds: 최근 24시간 클릭 집계 상위 N개 식당 id 목록 (CompanyHome이 /api/popular로 10분마다 갱신).
// 아직 클릭 데이터가 안 쌓였으면 빈 Set이 들어오고, 그러면 "최근많이찾는" 태그는 결과가 항상 0개가 된다.
function matchesSpecialFilter(
  key: SpecialFilterKey,
  restaurant: RestaurantSummary,
  favoriteIds: Set<string>,
  popularIds: Set<string>
): boolean {
  switch (key) {
    case "zeropay":
      return restaurant.isZeroPay;
    case "walk5":
      return (restaurant.distanceMeters ?? Infinity) <= 400;
    case "favorite":
      return favoriteIds.has(restaurant.id);
    case "groupdining":
      return isGroupDiningFriendly(restaurant.category, restaurant.name);
    case "recentlyPopular":
      return popularIds.has(restaurant.id);
    case "summer":
      return isSummerSpecialty(restaurant.category, restaurant.name);
    default:
      return true;
  }
}

// 카테고리 태그는 단일 선택(라디오처럼 동작) - "한식"이면서 동시에 "중식"인 식당은 없어서
// 복수선택을 허용하면 항상 결과가 0개가 되는 함정이 있기 때문. 그 외 특수 태그는 다중 선택(AND 결합).
export function filterRestaurants(
  restaurants: RestaurantSummary[],
  activeCategory: string | null,
  activeSpecialFilters: Set<SpecialFilterKey>,
  favoriteIds: Set<string>,
  popularIds: Set<string> = new Set()
): RestaurantSummary[] {
  return restaurants.filter((r) => {
    if (activeCategory && getCategoryVisual(r.category, r.categoryLabel).label !== activeCategory) return false;
    for (const key of activeSpecialFilters) {
      if (!matchesSpecialFilter(key, r, favoriteIds, popularIds)) return false;
    }
    return true;
  });
}

// FilterBar에서 "지금 이 회사 식당들 중 실제로 존재하는 카테고리"만 태그로 보여주기 위한 헬퍼.
// 카테고리 전체 목록이 아니라 실제 데이터 기준으로 뽑아야 진짜 "동적" 필터가 된다.
export function getAvailableCategoryLabels(restaurants: RestaurantSummary[]): string[] {
  const labels = new Set<string>();
  for (const r of restaurants) {
    labels.add(getCategoryVisual(r.category, r.categoryLabel).label);
  }
  return Array.from(labels).sort();
}
