import crypto from "node:crypto";
import { db } from "@/lib/firebase";
import { toNicknameId, resolveUniqueNickname } from "@/lib/nickname";
import { invalidateCompanyUsersCache } from "@/lib/user-server";

export const SESSION_COOKIE_NAME = "lt_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180일 - 재입력 최소화 목적

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET이 .env.local에 없습니다.");
  return secret;
}

function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 64).toString("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export interface SessionPayload {
  companyCode: string;
  nicknameId: string;
  nickname: string;
  exp: number; // epoch seconds
}

// HMAC 서명이 붙은 세션 토큰. JWT 라이브러리 없이 최소한으로 직접 구현
// (base64url 페이로드 + HMAC-SHA256 서명, 형식: "{payload}.{signature}").
export function signSessionToken(payload: SessionPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("base64url");

  if (!timingSafeEqualHex(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueToken(companyCode: string, nicknameId: string, nickname: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  return signSessionToken({ companyCode, nicknameId, nickname, exp });
}

export type AuthResult =
  | { status: "signup" | "login"; token: string; nickname: string; nicknameId: string }
  | { status: "conflict"; suggestion: string };

// 회사코드+닉네임+PIN을 한 번에 처리하는 가입/로그인 통합 흐름.
// - 해당 닉네임 문서가 없으면: 새 계정 생성 (가입)
// - 있고 PIN이 맞으면: 로그인
// - 있는데 PIN이 다르면: 다른 사람이 쓰고 있는 닉네임일 가능성이 높으므로, 유일한 대체 닉네임을 제안한다.
//   (기획 문서 방침대로 리뷰/신원 검증 장치는 두지 않는 내부 토이 프로젝트 수준이라 이 정도 처리로 충분하다고 판단)
export async function authenticate(
  companyCode: string,
  rawNickname: string,
  pin: string
): Promise<AuthResult> {
  const nickname = rawNickname.trim();
  const nicknameId = toNicknameId(nickname);
  const usersRef = db.collection("companies").doc(companyCode).collection("users");
  const userRef = usersRef.doc(nicknameId);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    const salt = crypto.randomBytes(16).toString("hex");
    const pinHash = hashPin(pin, salt);
    await userRef.set({
      nickname,
      pinSalt: salt,
      pinHash,
      createdAt: new Date().toISOString(),
    });
    // 2026-08-11 신규: 새 가입자가 listCompanyUsers() 캐시(user-server.ts, TTL 5분)에 바로
    // 반영되도록 무효화 - 안 하면 최대 5분 동안 친구목록/투표/룰렛 모달의 "전체 사용자" 목록에
    // 방금 가입한 사람이 안 보일 수 있다.
    invalidateCompanyUsersCache(companyCode);
    return {
      status: "signup",
      token: issueToken(companyCode, nicknameId, nickname),
      nickname,
      nicknameId,
    };
  }

  const data = snapshot.data()!;
  const computedHash = hashPin(pin, data.pinSalt);

  if (!timingSafeEqualHex(computedHash, data.pinHash)) {
    const existingDocs = await usersRef.listDocuments();
    const existingIds = new Set(existingDocs.map((doc) => doc.id));
    const suggestion = resolveUniqueNickname(nickname, existingIds);
    return { status: "conflict", suggestion };
  }

  return {
    status: "login",
    token: issueToken(companyCode, nicknameId, data.nickname),
    nickname: data.nickname,
    nicknameId,
  };
}

// ---- 비밀번호(PIN) 찾기 (보안 질문/답변) ----
// 2026-08-06 3차 신규: PIN을 잊었을 때 복구할 방법이 전혀 없었다 - 그래서 계정에 "질문/답변"을
// 하나 미리 등록해두고, 답변만 맞히면 PIN을 새로 설정할 수 있게 한다. 답변은 PIN과 동일한
// scrypt 해시 방식(hashPin 재사용)으로 저장한다(평문 저장 금지). 대소문자/공백 차이로 실패하는
// 걸 막기 위해 비교 전에 normalizeAnswer로 정규화한다. 이 기능 도입 이전에 가입한 계정은 질문이
// 없으므로 getSecurityQuestion이 null을 돌려주고, 그런 계정은 비밀번호 찾기를 쓸 수 없다(로그인
// 상태에서 '비밀번호 변경'을 통해 새로 등록하는 것만 가능 - PinResetModal 참고).
function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

export interface SecurityQuestionResult {
  question: string;
}

export async function getSecurityQuestion(
  companyCode: string,
  rawNickname: string
): Promise<SecurityQuestionResult | null> {
  const nicknameId = toNicknameId(rawNickname);
  const doc = await db.collection("companies").doc(companyCode).collection("users").doc(nicknameId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  if (!data.securityQuestion || !data.answerHash || !data.answerSalt) return null;
  return { question: data.securityQuestion };
}

export async function setSecurityQuestion(
  companyCode: string,
  nicknameId: string,
  question: string,
  answer: string
): Promise<void> {
  const salt = crypto.randomBytes(16).toString("hex");
  const answerHash = hashPin(normalizeAnswer(answer), salt);
  await db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .set({ securityQuestion: question, answerHash, answerSalt: salt }, { merge: true });
}

export async function verifySecurityAnswer(
  companyCode: string,
  rawNickname: string,
  answer: string
): Promise<{ ok: true; nicknameId: string } | { ok: false }> {
  const nicknameId = toNicknameId(rawNickname);
  const doc = await db.collection("companies").doc(companyCode).collection("users").doc(nicknameId).get();
  if (!doc.exists) return { ok: false };
  const data = doc.data()!;
  if (!data.answerHash || !data.answerSalt) return { ok: false };
  const computed = hashPin(normalizeAnswer(answer), data.answerSalt);
  if (!timingSafeEqualHex(computed, data.answerHash)) return { ok: false };
  return { ok: true, nicknameId };
}

export async function resetPin(
  companyCode: string,
  nicknameId: string,
  newPin: string
): Promise<{ nickname: string }> {
  const userRef = db.collection("companies").doc(companyCode).collection("users").doc(nicknameId);
  const doc = await userRef.get();
  if (!doc.exists) throw new Error("계정을 찾을 수 없습니다.");
  const salt = crypto.randomBytes(16).toString("hex");
  const pinHash = hashPin(newPin, salt);
  await userRef.set({ pinHash, pinSalt: salt }, { merge: true });
  return { nickname: doc.data()!.nickname };
}

// ---- PIN 재설정용 단기 토큰 ----
// forgot-password(답변 검증)와 reset-pin(실제 변경) API 호출을 두 번으로 나눠서, "답변을 안다"는
// 사실 확인과 "새 PIN을 저장한다"는 동작 사이에 검증되지 않은 값이 그대로 오가지 않게 한다.
// 세션 토큰과 같은 HMAC 서명 방식을 쓰지만 목적(purpose)과 만료 시간(10분, 세션의 180일보다
// 훨씬 짧게)이 다른 별도 토큰이다.
const VERIFY_TOKEN_TTL_SECONDS = 60 * 10;

export interface VerifyTokenPayload {
  companyCode: string;
  nicknameId: string;
  purpose: "pin-reset";
  exp: number;
}

export function signVerifyToken(payload: Omit<VerifyTokenPayload, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + VERIFY_TOKEN_TTL_SECONDS;
  const full: VerifyTokenPayload = { ...payload, exp };
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

export function verifyVerifyToken(token: string | undefined | null): VerifyTokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64)
    .digest("base64url");

  if (!timingSafeEqualHex(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as VerifyTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
