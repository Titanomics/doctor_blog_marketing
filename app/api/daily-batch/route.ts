import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 배치만 실행 (메일은 별도 크론으로 분리)
// Hobby 플랜 대응: batch-track 부모는 fire-and-forget 자식 후 ~3초 내 응답하므로 await 안전
export async function GET(request: NextRequest) {
  // 인증 정책 (Bearer 단일화 — UA 위조 우회 차단):
  // 1) Authorization: Bearer <CRON_SECRET> → 통과 (GitHub Actions / 외부 cron)
  // 2) NODE_ENV=development 이고 CRON_SECRET 미설정 → 통과 (개발 편의)
  // 그 외 (UA 만으로는 통과 X, 프로덕션 CRON_SECRET 미설정 포함) → 401 + 로깅
  // 비상시 vercel.json crons 부활 시 user-agent 분기를 다시 추가해야 함
  const userAgent = request.headers.get("user-agent") || "";
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === "development";

  const hasValidSecret = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const devFallback = isDev && !cronSecret;

  const authorized = hasValidSecret || devFallback;

  if (!authorized) {
    if (!cronSecret && !isDev) {
      console.error(
        "[daily-batch] AUTH-FAIL: CRON_SECRET이 프로덕션에 미설정. 외부 호출 거부 (DoS 방지).",
        { ua: userAgent.slice(0, 80) }
      );
    } else {
      console.warn(
        "[daily-batch] AUTH-FAIL: 인증 실패",
        { ua: userAgent.slice(0, 80), hasAuthHeader: !!auth }
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = new URL(request.url).origin;

  const batchUrls = [
    `${baseUrl}/api/batch-track`,
    `${baseUrl}/api/cafe/batch-track`,
    `${baseUrl}/api/reporter/batch-track`,
  ];

  // Promise.allSettled로 부모 응답 대기 (부모는 자식 fan-out 후 ~3초 내 응답)
  // TCP 중단 방지 + 모든 부모가 자식들을 확실히 트리거했는지 확인
  const results = await Promise.allSettled(
    batchUrls.map((url) =>
      fetch(url, { method: "POST" }).then(async (res) => {
        if (!res.ok) throw new Error(`${url} returned ${res.status}`);
        return res.json();
      })
    )
  );

  const summary = results.map((r, i) => ({
    url: batchUrls[i],
    status: r.status,
    result: r.status === "fulfilled" ? r.value : String(r.reason),
  }));

  return NextResponse.json({
    success: true,
    message: "배치 실행 시작 (블로그/카페/기자단)",
    batches: summary,
  });
}
