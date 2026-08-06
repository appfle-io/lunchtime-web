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

export interface RestaurantSummary {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string | null;
  isZeroPay: boolean;
  // 2026-08-06 신규: 제로페이 엄지척/거꾸로엄지척 투표 결과로 계산되는 값. isZeroPay 자체가
  // (등록 당시 기본값 false로 시작해서) 투표로 true로 바뀔 수 있는 필드라서, 이 플래그는
  // "기존에 제로페이 된다고 등록되어 있었는데 최근 거꾸로엄지척이 많이 들어와서 재확인이
  // 필요하다"는 별도 신호로 둔다 (lib/zeropay-server.ts 참고).
  isZeroPayNeedsReview?: boolean;
  distanceMeters?: number;
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
