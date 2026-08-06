import crypto from "node:crypto";
import { db } from "@/lib/firebase";
import { toNicknameId, resolveUniqueNickname } from "@/lib/nickname";

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

function issueToken(companyCode: string, nicknameId: string, nickname: string): string {
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
