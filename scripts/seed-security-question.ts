// 이미 존재하는(닉네임+PIN으로 이미 로그인해서 쓰고 있는) 계정에 비밀번호 찾기용 보안 질문/답변을
// 수기로 등록하는 스크립트. 계정이 아직 없으면 실행하지 않고 안내만 하고 종료한다 - PIN을 모르는
// 상태로 반쪽짜리(pinHash 없는) 계정을 만들면 그 닉네임으로 정상 로그인이 깨지기 때문이다.
//
// 사용법:
//   npm run seed:security-question -- ssg "시우야밥먹자" "아기 이름은?" "시우"
//
// 필요한 .env.local 값: FIREBASE_SERVICE_ACCOUNT_KEY, SESSION_SECRET (answerHash 계산에 필요)

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const [companyCodeArg, nicknameArg, questionArg, answerArg] = process.argv.slice(2);
  if (!companyCodeArg || !nicknameArg || !questionArg || !answerArg) {
    console.error(
      '사용법: npm run seed:security-question -- <companyCode> "<닉네임>" "<질문>" "<답변>"'
    );
    process.exit(1);
  }

  // dotenv.config()가 먼저 실행된 뒤에 firebase-admin을 초기화하는 lib/firebase.ts를 import해야
  // 서비스 계정 키를 정상적으로 읽는다 (seed-restaurants.ts와 동일한 이유로 동적 import 사용).
  const { normalizeCompanyCode } = await import("../src/lib/company");
  const { toNicknameId } = await import("../src/lib/nickname");
  const { db } = await import("../src/lib/firebase");
  const { setSecurityQuestion } = await import("../src/lib/auth-server");

  const companyCode = normalizeCompanyCode(companyCodeArg);
  const nicknameId = toNicknameId(nicknameArg);

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
  if (!data.pinHash || !data.pinSalt) {
    console.error("이 계정에는 PIN이 설정되어 있지 않습니다(비정상 상태). 안전을 위해 중단합니다.");
    process.exit(1);
  }

  await setSecurityQuestion(companyCode, nicknameId, questionArg, answerArg);

  console.log(
    `[완료] companies/${companyCode}/users/${nicknameId} (닉네임: ${data.nickname}) 계정에 ` +
      `보안 질문을 등록했습니다.\n` +
      `  질문: ${questionArg}\n` +
      `  (답변은 해시로 저장되어 콘솔에 표시하지 않습니다.)`
  );
}

main().catch((err) => {
  console.error("[등록 실패]", err);
  process.exit(1);
});
