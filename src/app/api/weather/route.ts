import { NextRequest, NextResponse } from "next/server";
import { getCompanyWeather } from "@/lib/weather-server";

// GET /api/weather?companyCode=xxx
// 회사 위치 기준 현재 날씨(기온+아이콘)를 돌려준다. 개인 데이터가 아니라(회사 전체가 같은 값을
// 보는 공용 정보) /api/popular와 마찬가지로 로그인 여부와 무관하게 조회 가능하게 했다.
export async function GET(request: NextRequest) {
  const companyCode = request.nextUrl.searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const weather = await getCompanyWeather(companyCode);
  // 날씨는 부가 기능이라 못 불러와도 200 + weather:null로 응답한다 - 프론트(WeatherWidget)가
  // null이면 그냥 조용히 안 보여주면 됨(에러 토스트 등을 띄우지 않음).
  return NextResponse.json({ weather });
}
