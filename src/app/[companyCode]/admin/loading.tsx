import LoadingOverlay from "@/components/LoadingOverlay";

// 2026-08-10 신규: 관리자 페이지(page.tsx)가 listRestaurants/listPendingEditRequests를 불러오는
// 동안 자동으로 보이는 로딩 화면 - "메인 → 관리자" 전환이 반응 없이 느껴지던 문제 대응.
export default function Loading() {
  return <LoadingOverlay message="관리자 페이지 불러오는 중..." />;
}
