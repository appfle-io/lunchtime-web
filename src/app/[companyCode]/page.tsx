import MapView from "@/components/MapView";
import RestaurantList from "@/components/RestaurantList";
import { normalizeCompanyCode } from "@/lib/company";

// 회사별 메인 화면. 지도를 배경 전체로 깔고, 리스트/필터는 바텀시트(모바일) /
// 플로팅 카드(데스크톱)로 얹는다 - 전형적인 "좌측 리스트 + 우측 지도" 틀을 피하는 구성.
// URL에 대문자가 섞여 들어와도(예: /SSG) 항상 정규화된 코드로 다뤄서
// Firestore의 companies/{정규화된코드} 문서와 일치시킨다.
// TODO: 정규화된 companyCode로 회사 정보(중심좌표) 조회 후 MapView에 전달.
export default function CompanyHomePage({ params }: { params: { companyCode: string } }) {
  const companyCode = normalizeCompanyCode(params.companyCode);

  return (
    <main className="relative h-screen w-full overflow-hidden">
      <MapView companyCode={companyCode} />

      {/* 데스크톱: 플로팅 카드 / 모바일: 하단 바텀시트로 전환되는 리스트 패널 */}
      <RestaurantList companyCode={companyCode} />
    </main>
  );
}
