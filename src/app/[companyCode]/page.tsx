import { cookies } from "next/headers";
import CompanyHome from "@/components/CompanyHome";
import AuthGate from "@/components/AuthGate";
import { normalizeCompanyCode } from "@/lib/company";
import { getCompanyByCode } from "@/lib/company-server";
import { listRestaurants } from "@/lib/restaurant-server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";

// 회사별 메인 화면. 로그인 세션이 없으면(또는 다른 회사 세션이면) AuthGate(닉네임+PIN)를 먼저 보여준다.
// 데이터 페칭은 여기(서버 컴포넌트)에서 하고,
// 지도/리스트 간 상태 공유(마커 포커스, 토스트 등)가 필요한 부분은 클라이언트 컴포넌트인 CompanyHome에 넘긴다.
export default async function CompanyHomePage({ params }: { params: { companyCode: string } }) {
  const companyCode = normalizeCompanyCode(params.companyCode);

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);

  if (!session || session.companyCode !== companyCode) {
    return <AuthGate companyCode={companyCode} />;
  }

  const company = await getCompanyByCode(companyCode);
  const restaurants = await listRestaurants(companyCode);

  return (
    <CompanyHome
      companyCode={companyCode}
      centerLat={company?.centerLat}
      centerLng={company?.centerLng}
      restaurants={restaurants}
      nickname={session.nickname}
    />
  );
}
