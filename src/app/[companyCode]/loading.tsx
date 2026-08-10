import LoadingOverlay from "@/components/LoadingOverlay";

// 2026-08-10 신규: Next.js App Router 규칙 - 같은 폴더의 page.tsx(회사 메인 화면, 서버 컴포넌트)가
// getCompanyByCode/listRestaurants/listFavoriteIds/isAdminUser를 순서대로 await하는 동안(로그인
// 직후 router.refresh(), 관리자 페이지에서 "← 메인으로", 회사코드 입력 후 첫 진입 전부 여기 해당)
// 자동으로 이 화면이 보인다. 별도로 로딩 상태를 관리할 필요 없이 파일만 있으면 Next.js가 처리한다.
export default function Loading() {
  return <LoadingOverlay message="불러오는 중..." />;
}
