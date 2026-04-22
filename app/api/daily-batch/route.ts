import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 배치만 실행 (메일은 별도 크론으로 분리)
// Hobby 플랜 대응: batch-track 부모는 fire-and-forget 자식 후 ~3초 내 응답하므로 await 안전
export async function GET(request: NextRequest) {
  // CRON_SECRET 체크 (Vercel Cron은 자동으로 이 헤더를 보냄)
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
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
