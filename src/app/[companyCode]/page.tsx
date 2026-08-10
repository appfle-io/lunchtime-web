import { cookies } from "next/headers";
import CompanyHome from "@/components/CompanyHome";
import AuthGate from "@/components/AuthGate";
import { normalizeCompanyCode } from "@/lib/company";
import { getCompanyByCode } from "@/lib/company-server";
import { listRestaurants } from "@/lib/restaurant-server";
import { listFavoriteIds } from "@/lib/favorite-server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";

// 회사별 메인 화면. 로그인 세션이 없으면(또는 다른 회사 세션이면) AuthGate(닉네임+PIN)를 먼저 보여준다.
// 데이터 페칭은 여기(서버 컴포넌트)에서 하고,
// 지도/리스트 간 상태 공유(마커 포커스, 토스트, 즐겨찾기, 필터 등)가 필요한 부분은
// 클라이언트 컴포넌트인 CompanyHome에 넘긴다.
export default async function CompanyHomePage({ params }: { params: { companyCode: string } }) {
  const companyCode = normalizeCompanyCode(params.companyCode);

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);

  if (!session || session.companyCode !== companyCode) {
    return <AuthGate companyCode={companyCode} />;
  }

  const company = await getCompanyByCode(companyCode);
  // 2026-08-10 신규: 관리자 페이지 "사용여부"에서 N 처리(isActive: false)한 가맹점은 메인
  // 화면(지도/리스트)에 안 보이게 여기서 걸러낸다 - 관리자 페이지는 listRestaurants()를
  // 그대로(필터 없이) 써서 사용여부와 무관하게 전체를 보여줘야 하니, 필터는 이 화면에서만 적용.
  const allRestaurants = await listRestaurants(companyCode);
  const restaurants = allRestaurants.filter((r) => r.isActive !== false);
  const favoriteIds = await listFavoriteIds(companyCode, session.nicknameId);
  // 2026-08-09 신규: 닉네임 드롭다운에 "관리자 페이지" 링크를 관리자에게만 보여주기 위한 조회.
  // 세션 토큰에 굽지 않고 매 페이지 로드마다 Firestore에서 최신 상태를 확인한다 (admin-server.ts 참고).
  const isAdmin = await isAdminUser(companyCode, session.nicknameId);

  return (
    <CompanyHome
      companyCode={companyCode}
      centerLat={company?.centerLat}
      centerLng={company?.centerLng}
      restaurants={restaurants}
      nickname={session.nickname}
      initialFavoriteIds={favoriteIds}
      isAdmin={isAdmin}
    />
  );
}
