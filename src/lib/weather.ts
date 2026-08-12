// 기상청 공공데이터포털 "단기예보 조회서비스(VilageFcstInfoService_2.0)" 중 초단기실황조회
// (getUltraSrtNcst) 하나만 사용한다.
//
// 초단기실황은 T1H(기온)/PTY(강수형태)는 주지만 SKY(하늘상태: 맑음/구름많음/흐림)는 안 준다 -
// SKY까지 받으려면 초단기예보(getUltraSrtFcst)를 별도로 더 불러야 하는데, "심플하게 기온+아이콘만"
// 이라는 요구사항(2026-08-12 브리핑에서 확정)에는 PTY(비/눈이 오는지 여부)만으로 아이콘을 정해도
// 충분하다고 판단해서 API 호출 1번으로 끝냈다 - 맑음/흐림은 구분하지 않고, "비/눈 여부"만 아이콘에
// 반영한다(PTY=0이면 시간대에 따라 해/달 아이콘). 나중에 하늘상태(구름 많음 등)까지 필요해지면
// 초단기예보 호출을 추가하면 된다.
//
// 서비스키(KMA_SERVICE_KEY)는 공공데이터포털이 이미 URL-Encode된 형태로 내려준다(활용가이드에도
// "인증키 (URL Encode)"라고 명시됨 - 예: ...UAA%3D%3D 처럼 =가 퍼센트인코딩된 채로 옴). 그래서
// fetch URL을 만들 때 URLSearchParams나 encodeURIComponent로 다시 감싸면 %가 %25로 한 번 더
// 인코딩되면서 인증 실패(SERVICE_KEY_IS_NOT_REGISTERED_ERROR 등)가 난다 - serviceKey만은 절대
// 추가 인코딩하지 말고 .env.local에 있는 값 그대로 쿼리스트링에 이어붙일 것.

const KMA_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";

const serviceKey = process.env.KMA_SERVICE_KEY;

interface KmaGrid {
  nx: number;
  ny: number;
}

// 위경도 -> 기상청 격자좌표(nx, ny) 변환 (Lambert Conformal Conic 투영).
// 기상청이 공식 배포하는 C 예제 코드(단기예보 Open API 활용가이드 첨부파일)를 그대로 포팅한 것 -
// 순수 수학 계산이라 외부 API 호출 없이 아무 위경도에 대해서나 즉시 계산할 수 있다. 회사가
// 늘어나도(이 프로젝트는 멀티테넌트로 설계됨) 이 함수 하나로 계속 재사용 가능해서, 회사 문서에
// nx/ny를 미리 계산해서 저장해두는 방식 대신 매 요청마다 계산하는 쪽을 택했다(비용도 무시할 만함).
// 예제값(위경도 126.929810, 37.488201 -> X=59, Y=125)으로 검증 완료.
function latLngToGrid(lat: number, lng: number): KmaGrid {
  const RE = 6371.00877; // 지구 반경 [km]
  const GRID = 5.0; // 격자 간격 [km]
  const SLAT1 = 30.0; // 표준위도1 [degree]
  const SLAT2 = 60.0; // 표준위도2 [degree]
  const OLON = 126.0; // 기준점 경도 [degree]
  const OLAT = 38.0; // 기준점 위도 [degree]
  const XO = 210 / GRID; // 기준점 X좌표 [격자거리]
  const YO = 675 / GRID; // 기준점 Y좌표 [격자거리]
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + (lat * DEGRAD) * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const x = ra * Math.sin(theta) + XO;
  const y = ro - ra * Math.cos(theta) + YO;

  return { nx: Math.trunc(x + 1.5), ny: Math.trunc(y + 1.5) };
}

// 초단기실황은 "매시 정시 생성, 10분마다 최신 정보로 업데이트"라 API가 실제로 응답 가능해지는
// 시점은 매시 10분 이후다(활용가이드의 "API 제공 시간" 표 기준). 지금이 정시로부터 10분이 안
// 지났으면 아직 그 시각 데이터가 없을 수 있으니 한 시간 전 발표를 요청한다 - 기온/강수형태는
// 한 시간 안에 크게 안 바뀌는 값이라 문제없다.
function getBaseDateTime(now: Date): { baseDate: string; baseTime: string } {
  // Vercel 서버는 UTC로 돌아가므로, 서버의 로컬 타임존에 의존하지 않고 여기서 KST(UTC+9)로
  // 명시적으로 변환한다 - "UTC+9시각을 UTC 필드로 읽는" 트릭.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (kst.getUTCMinutes() < 10) {
    kst.setUTCHours(kst.getUTCHours() - 1);
  }
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");

  return { baseDate: `${yyyy}${mm}${dd}`, baseTime: `${hh}00` };
}

// 강수형태(PTY) 코드 - 활용가이드 "코드값 정보" 참고: 0(없음)/1(비)/2(비,눈)/3(눈)/4(소나기)/
// 5(빗방울)/6(빗방울눈날림)/7(눈날림). 0일 때는 하늘상태를 모르니(초단기실황엔 SKY가 없음) 그냥
// "맑음"으로 표시하고, 시간대에 따라 해/달 아이콘만 바꾼다.
function ptyToCondition(pty: number, isDaytime: boolean): { condition: string; icon: string } {
  switch (pty) {
    case 0:
      return { condition: "맑음", icon: isDaytime ? "☀️" : "🌙" };
    case 1:
      return { condition: "비", icon: "🌧️" };
    case 2:
      return { condition: "비/눈", icon: "🌨️" };
    case 3:
      return { condition: "눈", icon: "❄️" };
    case 4:
      return { condition: "소나기", icon: "🌦️" };
    case 5:
      return { condition: "빗방울", icon: "🌦️" };
    case 6:
      return { condition: "빗방울눈날림", icon: "🌨️" };
    case 7:
      return { condition: "눈날림", icon: "🌨️" };
    default:
      return { condition: "정보없음", icon: "❓" };
  }
}

export interface CurrentWeather {
  tempC: number;
  pty: number;
  condition: string;
  icon: string;
  baseDate: string;
  baseTime: string;
}

interface KmaItem {
  category: string;
  obsrValue: string;
}

// 회사 위치(위경도) 기준 현재 날씨(기온+비/눈 여부)를 조회한다. 실패하면 예외를 던진다 -
// 호출부(weather-server.ts)가 캐싱과 함께 실패 시 null로 처리하는 정책을 갖고 있다.
export async function getCurrentWeather(lat: number, lng: number): Promise<CurrentWeather> {
  if (!serviceKey) {
    throw new Error("KMA_SERVICE_KEY가 설정되지 않았습니다. .env.local을 확인하세요.");
  }

  const { nx, ny } = latLngToGrid(lat, lng);
  const { baseDate, baseTime } = getBaseDateTime(new Date());

  // serviceKey는 이미 URL-Encode된 값이라 다시 encodeURIComponent로 감싸지 않는다(파일 상단 주석 참고).
  const url =
    `${KMA_ENDPOINT}?serviceKey=${serviceKey}` +
    `&numOfRows=10&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`기상청 API 오류 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  const header = data?.response?.header;
  if (header?.resultCode !== "00") {
    throw new Error(`기상청 API 오류 (${header?.resultCode}): ${header?.resultMsg}`);
  }

  const items: KmaItem[] = data?.response?.body?.items?.item ?? [];
  const byCategory = new Map(items.map((item) => [item.category, item.obsrValue]));

  const t1h = byCategory.get("T1H");
  const ptyRaw = byCategory.get("PTY");
  if (t1h === undefined || ptyRaw === undefined) {
    throw new Error("기상청 응답에 T1H/PTY 값이 없습니다.");
  }

  const kstHour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
  const isDaytime = kstHour >= 6 && kstHour < 18;
  const pty = Number(ptyRaw);
  const { condition, icon } = ptyToCondition(pty, isDaytime);

  return {
    tempC: Math.round(Number(t1h)),
    pty,
    condition,
    icon,
    baseDate,
    baseTime,
  };
}

// AI 추천(recommendLunch) 프롬프트에 넣기 좋은 짧은 문자열로 포맷 (예: "24도, 맑음").
export function formatWeatherLabel(weather: CurrentWeather): string {
  return `${weather.tempC}도, ${weather.condition}`;
}
