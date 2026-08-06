// NAVER API Hub 지역검색 API 호출 헬퍼. 서버(API route / server component / 시딩 스크립트)에서만 사용.
// NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET는 NEXT_PUBLIC이 아니므로 클라이언트 번들에는 노출되지 않지만,
// 그래도 클라이언트 컴포넌트에서 import하지 않도록 주의.

const NAVER_LOCAL_SEARCH_URL = "https://naverapihub.apigw.ntruss.com/search/v1/local";

export interface NaverLocalItem {
  title: string;
  link: string;
  category: string;
  description: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
}

interface NaverLocalResponse {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverLocalItem[];
}

export function stripHtmlTags(text: string): string {
  return text.replace(/<\/?[^>]+>/g, "").trim();
}

// mapx/mapy는 실제 위경도(WGS84)에 1e7을 곱해 정수 문자열로 내려온다.
// (공식 문서에는 이 스케일이 명시돼 있지 않아 실제 응답값을 찍어보고 확인함 - mapx=1269316586 -> 126.9316586)
export function parseNaverCoords(item: NaverLocalItem): { lat: number; lng: number } {
  return {
    lat: Number(item.mapy) / 1e7,
    lng: Number(item.mapx) / 1e7,
  };
}

export async function searchNaverLocal(query: string, display = 5): Promise<NaverLocalItem[]> {
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }

  const url = `${NAVER_LOCAL_SEARCH_URL}?query=${encodeURIComponent(query)}&display=${display}&start=1&sort=comment`;
  const res = await fetch(url, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`네이버 지역검색 API 오류 (${res.status}): ${body}`);
  }

  const data = (await res.json()) as NaverLocalResponse;
  return data.items ?? [];
}
