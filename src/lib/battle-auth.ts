"use client";

import { getAuth, signInWithCustomToken, signOut } from "firebase/auth";
import { firebaseApp } from "@/lib/firebase-client";
import { toBattleUid } from "@/lib/battle-key";

// 실시간 배틀용 Firebase 로그인 보장. 이미 같은 사용자(uid)로 로그인돼 있으면 네트워크 요청 없이
// 바로 끝난다(로그인 상태는 브라우저에 유지됨). 닉네임 변경 등으로 uid가 달라졌으면 새 토큰을 받는다.
export async function ensureBattleAuth(companyCode: string, nicknameId: string): Promise<void> {
  const auth = getAuth(firebaseApp);
  await auth.authStateReady();
  const expectedUid = toBattleUid(companyCode, nicknameId);
  if (auth.currentUser?.uid === expectedUid) return;

  const res = await fetch(`/api/battle/token?companyCode=${encodeURIComponent(companyCode)}`);
  if (!res.ok) throw new Error("실시간 배틀 인증에 실패했습니다. 다시 로그인해주세요.");
  const { token } = (await res.json()) as { token: string };
  await signInWithCustomToken(auth, token);
}

// 앱 로그아웃 시 배틀용 Firebase 로그인도 함께 정리한다.
export async function signOutBattle(): Promise<void> {
  try {
    await signOut(getAuth(firebaseApp));
  } catch {
    // 배틀을 한 번도 안 써서 로그인 상태가 없으면 무시
  }
}
