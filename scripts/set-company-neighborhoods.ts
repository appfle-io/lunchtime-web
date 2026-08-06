// company 문서에 neighborhoods(행정동 이름 목록) 필드를 영구 저장하는 스크립트. 한 번 저장해두면
// scripts/seed-restaurants.ts를 --neighborhoods 옵션 없이 그냥 실행해도(예: 매일 자동 실행되는
// 배치) 이 목록을 계속 써서 동 단위 검색을 한다.
//
// 사용법:
//   npm run set:neighborhoods -- ssg "영등포동1가,영등포동2가,영등포동3가,영등포동4가,영등포동5가,영등포동6가"
//
// 다시 실행하면 목록을 통째로 교체한다(누적/추가가 아님) - 항상 원하는 전체 목록을 다시 넣어줘.
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const [companyCodeArg, neighborhoodsArg] = process.argv.slice(2);
  if (!companyCodeArg || !neighborhoodsArg) {
    console.error('사용법: npm run set:neighborhoods -- <companyCode> "동1,동2,동3"');
    process.exit(1);
  }

  const neighborhoods = neighborhoodsArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (neighborhoods.length === 0) {
    console.error("동 이름을 하나 이상 넣어줘 (쉼표로 구분).");
    process.exit(1);
  }

  const { normalizeCompanyCode } = await import("../src/lib/company");
  const { db } = await import("../src/lib/firebase");

  const companyCode = normalizeCompanyCode(companyCodeArg);
  const companyRef = db.collection("companies").doc(companyCode);
  const snapshot = await companyRef.get();

  if (!snapshot.exists) {
    console.error(`companies/${companyCode} 문서를 찾을 수 없습니다. 회사코드를 확인해주세요.`);
    process.exit(1);
  }

  await companyRef.set({ neighborhoods }, { merge: true });

  console.log(`[완료] companies/${companyCode}.neighborhoods를 아래 ${neighborhoods.length}개로 저장했습니다.`);
  console.log(neighborhoods.map((n) => `  - ${n}`).join("\n"));
  console.log(
    `\n이제 npm run seed:restaurants -- ${companyCodeArg} 만 실행해도 이 동 목록으로 검색해요.`
  );
}

main().catch((err) => {
  console.error("[저장 실패]", err);
  process.exit(1);
});
