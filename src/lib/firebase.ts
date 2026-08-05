import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 서버(Next.js API 라우트)에서 Firestore를 읽고 쓰기 위한 Admin SDK 초기화.
// FIREBASE_SERVICE_ACCOUNT_KEY: Firebase 콘솔 > 프로젝트 설정 > 서비스 계정에서 발급한
// JSON 키 파일의 내용을 그대로 한 줄 문자열로 넣는다 (.env.local 참고).
// packinbag과는 별도의 Firebase 프로젝트를 새로 만들어 쓰는 걸 권장 (데이터/쿼터 격리).
function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return JSON.parse(raw);
}

if (!getApps().length) {
  initializeApp({ credential: cert(getServiceAccount()) });
}

export const db = getFirestore();
