import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

// 블로그 + 카페 + 기자단 배치 완료 후 → 일일 리포트 메일 발송
export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  try {
    // 1단계: 3개 배치를 병렬로 실행 (각각 내부에서 클라이언트별 팬아웃)
    const [blogResult, cafeResult, reporterResult] = await Promise.allSettled([
      fetch(`${baseUrl}/api/batch-track`, { method: "POST" }),
      fetch(`${baseUrl}/api/cafe/batch-track`, { method: "POST" }),
      fetch(`${baseUrl}/api/reporter/batch-track`, { method: "POST" }),
    ]);

    const blogData =
      blogResult.status === "fulfilled" && blogResult.value.ok
        ? await blogResult.value.json()
        : { error: "블로그 배치 실패" };

    const cafeData =
      cafeResult.status === "fulfilled" && cafeResult.value.ok
        ? await cafeResult.value.json()
        : { error: "카페 배치 실패" };

    const reporterData =
      reporterResult.status === "fulfilled" && reporterResult.value.ok
        ? await reporterResult.value.json()
        : { error: "블로그기자단 배치 실패" };

    // 2단계: 배치 완료 후 일일 리포트 메일 발송
    let reportData = null;
    try {
      const reportHeaders: Record<string, string> = {};
      if (process.env.CRON_SECRET) {
        reportHeaders["authorization"] = `Bearer ${process.env.CRON_SECRET}`;
      }
      const reportRes = await fetch(`${baseUrl}/api/cafe/daily-report`, {
        method: "POST",
        headers: reportHeaders,
      });
      reportData = reportRes.ok
        ? await reportRes.json()
        : { error: "리포트 발송 실패" };
    } catch {
      reportData = { error: "리포트 호출 오류" };
    }

    return NextResponse.json({
      success: true,
      blog: blogData,
      cafe: cafeData,
      reporter: reporterData,
      report: reportData,
    });
  } catch (error) {
    console.error("daily-batch error:", error);
    return NextResponse.json(
      { error: "배치 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
