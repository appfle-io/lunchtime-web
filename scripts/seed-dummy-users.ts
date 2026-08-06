// 친구목록/투표 등 다중 인원 기능을 테스트해볼 더미 계정을 한 번에 만들어주는 스크립트.
// 실제 계정과 구분하려고 Firestore 문서에 isDummy:true 필드를 반드시 남겨두고, 나중에
// scripts/remove-dummy-users.ts로 그 필드를 기준으로 깨끗하게 지울 수 있게 한다.
//
// 사용법:
//   npm run seed:dummy-users -- ssg 10
//   npm run seed:dummy-users -- ssg 10 "더미"   (닉네임 접두사를 바꾸고 싶을 때, 기본값 "더미")
//
// 만들어지는 닉네임: "더미1", "더미2", ... "더미10" (이미 같은 닉네임이 존재하면 건너뛰고 알려준다 -
// 실수로 실제 계정을 덮어쓰지 않기 위한 안전장치).
// 모든 더미 계정의 PIN은 "0000"으로 동일하게 설정한다(테스트 로그인용, 실제 서비스에 쓰지 말 것).
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY

import dotenv from "dotenv";
import path from "node:path";
import crypto from "node:crypto";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DUMMY_PIN = "0000";

function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 64).toString("hex");
}

async function main() {
  const [companyCodeArg, countArg, prefixArg] = process.argv.slice(2);
  if (!companyCodeArg || !countArg) {
    console.error('사용법: npm run seed:dummy-users -- <companyCode> <개수> ["닉네임 접두사"]');
    process.exit(1);
  }

  const count = Number(countArg);
  if (!Number.isInteger(count) || count <= 0 || count > 100) {
    console.error("개수는 1~100 사이의 정수여야 합니다.");
    process.exit(1);
  }
  const prefix = prefixArg?.trim() || "더미";

  // dotenv.config()가 먼저 실행된 뒤에 firebase-admin을 초기화하는 lib/firebase.ts를 import해야
  // 서비스 계정 키를 정상적으로 읽는다 (seed-restaurants.ts / seed-security-question.ts와 동일한 이유).
  const { normalizeCompanyCode } = await import("../src/lib/company");
  const { toNicknameId } = await import("../src/lib/nickname");
  const { db } = await import("../src/lib/firebase");

  const companyCode = normalizeCompanyCode(companyCodeArg);
  const usersRef = db.collection("companies").doc(companyCode).collection("users");

  let created = 0;
  let skipped = 0;

  for (let i = 1; i <= count; i += 1) {
    const nickname = `${prefix}${i}`;
    const nicknameId = toNicknameId(nickname);
    const userRef = usersRef.doc(nicknameId);
    const existing = await userRef.get();

    if (existing.exists) {
      console.log(`[건너뜀] "${nickname}" - 이미 존재하는 닉네임입니다.`);
      skipped += 1;
      continue;
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const pinHash = hashPin(DUMMY_PIN, salt);
    await userRef.set({
      nickname,
      pinSalt: salt,
      pinHash,
      createdAt: new Date().toISOString(),
      isDummy: true, // remove-dummy-users.ts가 이 필드로 삭제 대상을 찾는다.
    });
    created += 1;
  }

  console.log(
    `\n[완료] companies/${companyCode} 에 더미 계정 ${created}개 생성 (건너뜀 ${skipped}개).\n` +
      `모든 더미 계정 PIN: "${DUMMY_PIN}"\n` +
      `나중에 지우려면: npm run remove:dummy-users -- ${companyCodeArg}`
  );
}

main().catch((err) => {
  console.error("[생성 실패]", err);
  process.exit(1);
});
