// 2026-08-06 저녁 추가: "렉이 심하다"는 문제를 진단하면서, 근본 원인이 식당 데이터 규모(시군구
// 전체 vs 특정 동만) 때문인지 빠르게 확인하기 위한 1회성 스크립트. 회사 문서의 neighborhoods
// 설정 여부와 실제 식당 문서 수(source별로도 나눠서)를 콘솔에 출력한다.
//
// 사용법: npx tsx scripts/check-restaurant-scale.ts ssg

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const [companyCodeArg] = process.argv.slice(2);
  if (!companyCodeArg) {
    console.error("사용법: npx tsx scripts/check-restaurant-scale.ts <companyCode>");
    process.exit(1);
  }

  const { getCompanyByCode } = await import("../src/lib/company-server");
  const { db } = await import("../src/lib/firebase");

  const company = await getCompanyByCode(companyCodeArg);
  if (!company) {
    console.error(`companies/${companyCodeArg} 문서를 찾을 수 없습니다.`);
    process.exit(1);
  }

  console.log("=== 회사 설정 ===");
  console.log("signguCd:", company.signguCd ?? "(없음)");
  console.log(
    "neighborhoods:",
    company.neighborhoods && company.neighborhoods.length > 0
      ? company.neighborhoods
      : "(없음 - 설정 안 돼있으면 시군구 전체가 다 들어와 있을 가능성이 높음)"
  );

  const snapshot = await db.collection("companies").doc(companyCodeArg).collection("restaurants").get();
  console.log("\n=== 식당 문서 수 ===");
  console.log("전체:", snapshot.size, "건");

  const bySource = new Map<string, number>();
  snapshot.docs.forEach((doc) => {
    const source = (doc.data().source as string) ?? "(source 없음)";
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  });
  for (const [source, count] of bySource) {
    console.log(`  - ${source}: ${count}건`);
  }

  console.log(
    "\n참고: 전체 건수가 수백~수천이면, 지도/리스트 최적화만으로는 한계가 있고 " +
      "neighborhoods를 좁게 설정한 뒤 opendata 시딩을 다시 돌리거나(npm run seed:opendata), " +
      "listRestaurants()에 반경/페이지네이션을 추가하는 걸 권장합니다."
  );
}

main().catch((err) => {
  console.error("[확인 실패]", err);
  process.exit(1);
});
