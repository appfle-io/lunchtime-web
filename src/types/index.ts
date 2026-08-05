export interface CompanySummary {
  id: string;
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
}

export interface RestaurantSummary {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string | null;
  isZeroPay: boolean;
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
