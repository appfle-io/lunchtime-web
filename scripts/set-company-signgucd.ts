// company 문서에 signguCd(5자리 시군구코드) 필드를 영구 저장하는 스크립트.
// scripts/seed-restaurants-opendata.ts가 이 값을 읽어서 공공데이터포털 API를 호출한다.
//
// 사용법:
//   npm run set:signgucd -- ssg 11560   (서울 영등포구 예시)
//
// 시군구코드를 모를 경우: 행정표준코드관리시스템(https://www.code.go.kr) > 법정동코드 조회에서
// "영등포구"로 검색하면 앞 5자리가 시군구코드다.
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const [companyCodeArg, signguCdArg] = process.argv.slice(2);
  if (!companyCodeArg || !signguCdArg) {
    console.error("사용법: npm run set:signgucd -- <companyCode> <5자리 시군구코드>");
    process.exit(1);
  }

  const signguCd = signguCdArg.trim();
  if (!/^\d{5}$/.test(signguCd)) {
    console.error(`시군구코드는 5자리 숫자여야 합니다 (입력값: "${signguCd}").`);
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

  await companyRef.set({ signguCd }, { merge: true });

  console.log(`[완료] companies/${companyCode}.signguCd를 "${signguCd}"로 저장했습니다.`);
  console.log(`이제 npm run seed:opendata -- ${companyCodeArg} 를 실행할 수 있어요.`);
}

main().catch((err) => {
  console.error("[저장 실패]", err);
  process.exit(1);
});
