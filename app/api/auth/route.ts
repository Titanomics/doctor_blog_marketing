import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  checkPassword,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth";
import { usingServiceRole } from "@/lib/supabase";
import { hasNaverAdKeys } from "@/lib/naverAd";
import { slackConfigStatus, slackConfigured } from "@/lib/slack";

// 로그인 실패 제한 (인스턴스 메모리 기준 — 서버리스에서는 인스턴스별로 따로 센다)
const MAX_FAILS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const fails = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isBlocked(ip: string, now: number): boolean {
  const f = fails.get(ip);
  if (!f) return false;
  if (f.resetAt <= now) {
    fails.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILS;
}

function recordFail(ip: string, now: number) {
  const f = fails.get(ip);
  if (!f || f.resetAt <= now) {
    fails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    f.count++;
  }
}

// 세션 확인
export async function GET(request: NextRequest) {
  const authenticated = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json(
    // 설정 점검용(로그인 시에만 노출): db = Supabase 접속 키 종류, naverAd = 검색광고 API 키 3개 설정 여부
    authenticated
      ? { authenticated, db: usingServiceRole ? "service_role" : "anon", naverAd: hasNaverAdKeys(), slack: slackConfigured(), slackConfig: slackConfigStatus() }
      : { authenticated },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// 로그인
export async function POST(request: NextRequest) {
  if (!process.env.MASTER_PASSWORD) {
    return NextResponse.json(
      { error: "서버 설정 오류: 비밀번호가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const now = Date.now();
  const ip = clientIp(request);
  if (isBlocked(ip, now)) {
    return NextResponse.json(
      { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429 }
    );
  }

  let password: unknown;
  try {
    password = (await request.json())?.password;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!checkPassword(password)) {
    recordFail(ip, now);
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const token = createSessionToken(now);
  if (!token) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  fails.delete(ip);
  const res = NextResponse.json({ success: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}

// 로그아웃
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
