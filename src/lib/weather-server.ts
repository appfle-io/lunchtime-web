import { getCompanyByCode } from "@/lib/company-server";
import { getCurrentWeather, type CurrentWeather } from "@/lib/weather";

// 회사당 날씨를 캐싱한다 - 초단기실황은 어차피 매시간 정시에만 갱신되는 데이터라, 같은 회사
// 인원 전체가 20분 안에 여러 번 요청해도 매번 기상청 API를 부를 필요가 없다
// (popular-server.ts/restaurant-server.ts와 동일한 인메모리 TTL 캐시 패턴).
const WEATHER_CACHE_TTL_MS = 20 * 60 * 1000;
const weatherCache = new Map<string, { data: CurrentWeather; expiresAt: number }>();

// 회사 위치 좌표가 없거나 기상청 API가 실패하면 null을 반환한다 - 날씨는 부가 정보라 실패해도
// 지도/AI추천 자체는 계속 동작해야 한다(호출부가 조용히 무시하는 패턴, popular-server.ts와 동일).
export async function getCompanyWeather(companyCode: string): Promise<CurrentWeather | null> {
  const cached = weatherCache.get(companyCode);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const company = await getCompanyByCode(companyCode);
  if (!company || typeof company.centerLat !== "number" || typeof company.centerLng !== "number") {
    return null;
  }

  try {
    const weather = await getCurrentWeather(company.centerLat, company.centerLng);
    weatherCache.set(companyCode, { data: weather, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
    return weather;
  } catch (err) {
    console.error(`[weather-server] ${companyCode} 날씨 조회 실패:`, err);
    return null;
  }
}
