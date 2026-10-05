import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  isJobAuthorization,
  verifySessionToken,
  type Principal,
} from "@/lib/auth";

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*"],
};

// 배치 워커: 사용자는 POST(수동 갱신)만, job은 GET/POST 모두.
const BATCH_PATHS = new Set([
  "/api/batch-track",
  "/api/cafe/batch-track",
  "/api/reporter/batch-track",
]);

// 자동화 전용: 사용자 세션으로는 호출 불가.
const JOB_ONLY_PATHS = new Set([
  "/api/daily-batch",
  "/api/cafe/daily-report",
  "/api/cafe/keywords/backfill-published",
  "/api/cafe/post-stats",
  "/api/keyword-volumes/collect",
  "/api/reporter/entries/backfill-published",
]);

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// job이 읽을 수 있는 목록 (워크플로우가 대상 고객·키워드 수를 구할 때 사용)
const JOB_READ_PATHS = new Set([
  "/api/clients",
  "/api/keywords",
  "/api/cafe/clients",
  "/api/cafe/keywords",
]);

// 쿠키로 인증하는 변경 요청은 같은 출처에서 온 것만 받는다 (CSRF 방지).
// Origin이 없으면 브라우저의 Sec-Fetch-Site로 판단하고, 둘 다 없으면 거부.
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
      const o = new URL(origin);
      // 운영에서는 https만. 개발 중에는 http://localhost, LAN 주소 접속도 허용.
      return o.host === host && (o.protocol === "https:" || process.env.NODE_ENV !== "production");
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;
  const isApi = path.startsWith("/api/");

  const isRead = method === "GET" || method === "HEAD";

  if (path === "/api/auth") {
    if (!isRead && !sameOrigin(request)) {
      return deny(403, "허용되지 않는 출처의 요청입니다.");
    }
    return NextResponse.next();
  }

  const principal: Principal | null = isJobAuthorization(
    request.headers.get("authorization")
  )
    ? "job"
    : verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
      ? "user"
      : null;

  if (!principal) {
    if (isApi) return deny(401, "로그인이 필요합니다.");
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isApi) return NextResponse.next();

  if (principal === "job") {
    // job은 정해진 목록 조회 + 배치/리포트/백필 실행만. 그 외 업무 데이터 접근은 불가.
    if (
      (isRead && JOB_READ_PATHS.has(path)) ||
      BATCH_PATHS.has(path) ||
      JOB_ONLY_PATHS.has(path)
    ) {
      return NextResponse.next();
    }
    return deny(403, "자동화 자격증명으로는 허용되지 않는 요청입니다.");
  }

  // user
  if (JOB_ONLY_PATHS.has(path)) {
    return deny(403, "자동화 전용 경로입니다.");
  }
  if (BATCH_PATHS.has(path) && method !== "POST") {
    // 쿠키가 실리는 GET(링크 클릭 등)으로 배치가 실행되는 것을 차단
    return deny(405, "POST로 호출해야 합니다.");
  }
  if (!isRead && !sameOrigin(request)) {
    return deny(403, "허용되지 않는 출처의 요청입니다.");
  }
  return NextResponse.next();
}
