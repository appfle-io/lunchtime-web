// 특정 회사의 특정 닉네임 계정에 관리자(isAdmin) 권한을 부여/회수하는 1회성 스크립트.
// 계정이 아직 없으면(그 닉네임으로 로그인/가입한 적이 없으면) 실행하지 않고 안내만 하고 종료한다
// (scripts/seed-security-question.ts와 동일한 안전장치 패턴).
//
// 사용법:
//   npm run set:admin -- ssg "시우야밥먹자" true    (관리자 권한 부여)
//   npm run set:admin -- ssg "시우야밥먹자" false   (관리자 권한 회수)
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const [companyCodeArg, nicknameArg, valueArg] = process.argv.slice(2);
  if (!companyCodeArg || !nicknameArg || (valueArg !== "true" && valueArg !== "false")) {
    console.error('사용법: npm run set:admin -- <companyCode> "<닉네임>" <true|false>');
    process.exit(1);
  }

  // dotenv.config()가 먼저 실행된 뒤에 firebase-admin을 초기화하는 lib/firebase.ts를 import해야
  // 서비스 계정 키를 정상적으로 읽는다 (다른 seed 스크립트들과 동일한 이유로 동적 import 사용).
  const { normalizeCompanyCode } = await import("../src/lib/company");
  const { toNicknameId } = await import("../src/lib/nickname");
  const { db } = await import("../src/lib/firebase");

  const companyCode = normalizeCompanyCode(companyCodeArg);
  const nicknameId = toNicknameId(nicknameArg);
  const isAdmin = valueArg === "true";

  const userRef = db.collection("companies").doc(companyCode).collection("users").doc(nicknameId);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    console.error(
      `companies/${companyCode}/users/${nicknameId} 문서가 없습니다.\n` +
        `이 닉네임으로 먼저 사이트에서 로그인(=자동 가입)한 뒤에 다시 실행해주세요.\n` +
        `(회사코드가 "${companyCode}"가 맞는지도 다시 확인해줘 - 다르면 인자를 바꿔서 재시도)`
    );
    process.exit(1);
  }

  const data = snapshot.data()!;
  await userRef.set({ isAdmin }, { merge: true });

  console.log(
    `[완료] companies/${companyCode}/users/${nicknameId} (닉네임: ${data.nickname}) 계정의 ` +
      `isAdmin을 ${isAdmin}로 설정했습니다.`
  );
}

main().catch((err) => {
  console.error("[설정 실패]", err);
  process.exit(1);
});
