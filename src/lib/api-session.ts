import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth-server";

// API 라우트 공용 세션 확인. 로그인 세션이 있고, 그 세션의 회사코드가 요청의 회사코드와 같을 때만
// 세션을 돌려준다. 서명 검증만 하므로 Firestore 읽기가 발생하지 않는다.
// 비로그인 요청으로 다른 회사 경로를 읽거나 쓰는 것(그리고 그만큼의 Firestore 과금)을 막기 위해
// 조회 전용 API에도 이 검사를 건다.
export function getSessionForCompany(companyCode: string | null | undefined): SessionPayload | null {
  if (!companyCode) return null;
  const session = verifySessionToken(cookies().get(SESSION_COOKIE_NAME)?.value);
  if (!session || session.companyCode !== companyCode) return null;
  return session;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}
