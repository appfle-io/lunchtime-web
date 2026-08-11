export interface CompanySummary {
  id: string;
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
  districtCode?: string;
  landmarks?: string[];
  // 2026-08-06 신규: "영등포동1가"~"영등포동6가"처럼 동 단위로 촘촘하게 훑어야 하는 지역 목록.
  // landmarks(특정 건물/장소)와 다르게 행정동 이름 자체를 검색어로 써서 그 동네 전체를 넓게 커버한다.
  neighborhoods?: string[];
  // 2026-08-06 신규: 공공데이터포털(소상공인시장진흥공단 상가정보) API에 넘길 5자리 시군구코드
  // (예: 서울 영등포구 = "11560"). scripts/seed-restaurants-opendata.ts에서 사용.
  signguCd?: string;
}

// 2026-08-09 신규: scripts/enrich-official-final.ts가 네이버 지도 [매장] 스마트주문 탭(실패 시
// 모바일 메뉴탭 → DOM 텍스트 파싱까지 3단 폴백)에서 수집해서 restaurants 문서에 저장해두는 메뉴
// 정보. 상위 10개까지만 저장된다. 사진(image)은 이 스크립트부터 의도적으로 완전히 제거됨 -
// 필드 자체를 안 둔다(과거 enrich 스크립트가 남겨둔 image/mainImage 필드가 문서에 남아있어도
// 이 타입에서 아예 안 읽으니 화면에 노출되지 않는다).
export interface RestaurantMenuItem {
  name: string;
  price?: string | null;
  description?: string | null;
  // "대표"/"인기" 등 네이버가 표시해둔 태그 원본 목록.
  tags?: string[];
  isRepresentative?: boolean;
  isPopular?: boolean;
}

export interface RestaurantSummary {
  id: string;
  name: string; // 기본/호환용 상호명
  displayName?: string; // 메인 화면 최종 표출명 (네이버맵 상호명 naverMatchedName 최우선)
  zeroPayOfficialName?: string | null; // 제로페이 공식 가맹점 등록 상호명
  businessName?: string | null; // 사업자등록상 명칭 (최초 CSV/시딩명)
  naverMatchedName?: string | null; // 네이버맵 매칭 상호명
  address: string;
  lat: number;
  lng: number;
  category?: string | null;
  // 2026-08-07 신규: Gemini로 재분류한 확정 카테고리 라벨(restaurant-category.ts의 CATEGORY_LABELS
  // 중 하나). 정부 데이터로 시딩된 category 원본 텍스트가 뭉뚱그려져 있어서("고기"인데 "한식음식점"
  // 으로만 찍힌 경우 등) 필터가 부정확했던 문제를 보완하기 위한 필드 - scripts/classify-categories-ai.ts
  // 참고. 있으면 getCategoryVisual()이 이 값을 최우선으로 쓴다.
  categoryLabel?: string | null;
  isZeroPay: boolean;
  // 2026-08-06 신규: 제로페이 엄지척/거꾸로엄지척 투표 결과로 계산되는 값. isZeroPay 자체가
  // (등록 당시 기본값 false로 시작해서) 투표로 true로 바뀔 수 있는 필드라서, 이 플래그는
  // "기존에 제로페이 된다고 등록되어 있었는데 최근 거꾸로엄지척이 많이 들어와서 재확인이
  // 필요하다"는 별도 신호로 둔다 (lib/zeropay-server.ts 참고).
  isZeroPayNeedsReview?: boolean;
  distanceMeters?: number;

  // 2026-08-09 신규: scripts/enrich-naver-details.ts(및 최종 버전 enrich-official-final.ts)가
  // 네이버 지도 상세페이지(Playwright)에서 수집해 restaurants 문서에 update()해두고 있던 필드들.
  // 지금까지는 DB에만 저장되고 listRestaurants()가 안 읽어와서 화면에 전혀 노출되지 않았던 것을
  // 이번에 연결함. 리뷰 원문(recentReviews)은 저작권/개인정보 이슈로 일단 제외 - 노출 안 함.
  // 대표이미지/메뉴사진(mainImage, menus[].image)은 2026-08-09 최종 수집 단계에서 의도적으로
  // 완전히 제거됐으므로 이 타입에 필드 자체를 두지 않는다.
  phone?: string | null;
  // 영업시간 원본 구조. 네이버 내부(Apollo 캐시) 응답 그대로라 스키마가 일정하지 않아서
  // unknown으로 두고, 화면에서 방어적으로(형태를 가려가며) 렌더링한다.
  businessHours?: unknown;
  facilities?: string[];
  paymentMethods?: string[];
  // 네이버 AI 한줄 요약(스마트콜/스마트요약). 없으면 null.
  aiBriefing?: string | null;
  menus?: RestaurantMenuItem[];
  // 네이버지도 상세 페이지 링크 - "네이버지도에서 보기" 외부링크용.
  naverPlaceUrl?: string | null;

  // 사내 제휴 혜택 정보 (benefit: 혜택 내용, note: 비고 조건)
  discountInfo?: {
    benefit?: string | null;
    note?: string | null;
  } | null;

  // 2026-08-10 신규: 관리자 페이지 "사용여부" 컬럼. 기존 문서엔 이 필드가 아예 없는데,
  // restaurant-server.ts의 toRestaurantSummary()가 값이 없으면(undefined) true로 취급하므로
  // "모든 기존 가맹점은 기본 TRUE"가 별도 마이그레이션 없이 자동으로 보장된다. 관리자가 이 값을
  // false(=N)로 바꾸면 메인 화면(지도/리스트)에서 제외된다(app/[companyCode]/page.tsx에서 필터).
  isActive?: boolean;
}

export interface ReviewSummary {
  id: string;
  authorNickname: string;
  content: string;
  rating?: number | null;
  createdAt: string;
}

export interface SessionUser {
  userId: string;
  companyId: string;
  companyCode: string;
  nickname: string;
}
