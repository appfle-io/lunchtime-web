// scripts/seed-dummy-users.ts로 만든 더미 계정을 정리하는 스크립트. isDummy:true 필드가 있는
// 문서만 지우기 때문에, 실제 계정을 실수로 지울 위험이 없다(실제 가입 흐름은 이 필드를 절대
// 쓰지 않음).
//
// 사용법:
//   npm run remove:dummy-users -- ssg
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const [companyCodeArg] = process.argv.slice(2);
  if (!companyCodeArg) {
    console.error("사용법: npm run remove:dummy-users -- <companyCode>");
    process.exit(1);
  }

  const { normalizeCompanyCode } = await import("../src/lib/company");
  const { db } = await import("../src/lib/firebase");

  const companyCode = normalizeCompanyCode(companyCodeArg);
  const usersRef = db.collection("companies").doc(companyCode).collection("users");

  const snapshot = await usersRef.where("isDummy", "==", true).get();

  if (snapshot.empty) {
    console.log(`companies/${companyCode}에 isDummy:true인 계정이 없습니다. 지울 게 없어요.`);
    return;
  }

  const names: string[] = [];
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    names.push(doc.data().nickname ?? doc.id);
    batch.delete(doc.ref);
  });
  await batch.commit();

  console.log(`[완료] companies/${companyCode}에서 더미 계정 ${names.length}개를 지웠습니다.`);
  console.log(names.map((n) => `  - ${n}`).join("\n"));
}

main().catch((err) => {
  console.error("[삭제 실패]", err);
  process.exit(1);
});
