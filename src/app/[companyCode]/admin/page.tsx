import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminDashboard from "@/components/AdminDashboard";
import { normalizeCompanyCode } from "@/lib/company";
import { listRestaurants } from "@/lib/restaurant-server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { listPendingEditRequests } from "@/lib/restaurant-edit-request-server";

// 2026-08-09 신규: 관리자 페이지. 세션이 없거나 이 회사 관리자가 아니면 메인(`/{companyCode}`)으로
// 되돌려 보낸다 - URL을 직접 쳐서 들어오는 경우까지 여기서 막는다(관리자 API 라우트들도 별도로
// 한 번 더 확인하니 이중 방어).
export default async function AdminPage({ params }: { params: { companyCode: string } }) {
  const companyCode = normalizeCompanyCode(params.companyCode);

  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);

  if (!session || session.companyCode !== companyCode) {
    redirect(`/${companyCode}`);
  }

  const isAdmin = await isAdminUser(companyCode, session.nicknameId);
  if (!isAdmin) {
    redirect(`/${companyCode}`);
  }

  const restaurants = await listRestaurants(companyCode);
  const pendingRequests = await listPendingEditRequests(companyCode);

  return (
    <AdminDashboard
      companyCode={companyCode}
      nickname={session.nickname}
      restaurants={restaurants}
      initialPendingRequests={pendingRequests}
    />
  );
}
