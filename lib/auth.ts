// 서버 인증 공통 모듈. proxy.ts와 /api/auth 에서 사용.
// 주체는 둘: user(로그인 쿠키) / job(Authorization: Bearer CRON_SECRET).

import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "bkr_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 7일

export type Principal = "user" | "job";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// 서명 키는 env에서 파생한다. 비밀번호가 항상 포함되므로
// 비밀번호를 바꾸면 기존 세션이 모두 무효화된다. SESSION_SECRET은 선택.
function sessionKey(): string | null {
  const password = process.env.MASTER_PASSWORD;
  if (!password) return null;
  const secret = process.env.SESSION_SECRET ?? process.env.CRON_SECRET ?? "";
  return createHash("sha256").update(`session:${secret}:${password}`).digest("hex");
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function checkPassword(input: unknown): boolean {
  const password = process.env.MASTER_PASSWORD;
  if (!password || typeof input !== "string") return false;
  return safeEqual(input, password);
}

// 토큰 형식: "<만료 epoch초>.<HMAC>"
export function createSessionToken(nowMs: number = Date.now()): string | null {
  const key = sessionKey();
  if (!key) return null;
  const exp = String(Math.floor(nowMs / 1000) + SESSION_MAX_AGE_S);
  return `${exp}.${sign(exp, key)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  nowMs: number = Date.now()
): boolean {
  if (!token) return false;
  const key = sessionKey();
  if (!key) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (!safeEqual(sig, sign(exp, key))) return false;
  return Number(exp) * 1000 > nowMs;
}

// HTTP 헤더 값은 바이트열(latin1)로 전달된다. 시크릿에 비ASCII 문자가 있어도
// 맞도록 헤더의 원본 바이트와 시크릿의 UTF-8 바이트를 비교한다.
export function isJobAuthorization(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const got = Buffer.from(header, "latin1");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

// 서버가 자기 자신의 배치 라우트를 다시 호출할 때 붙이는 헤더.
export function internalAuthHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return {};
  return { Authorization: Buffer.from(`Bearer ${secret}`, "utf8").toString("latin1") };
}
