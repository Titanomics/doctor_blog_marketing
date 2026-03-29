import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const BATCH_TIMEOUT_MS = 4 * 60 * 1000; // 배치에 최대 4분, 나머지 1분은 메일용

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

// 블로그 + 카페 + 기자단 배치 실행 → 일일 리포트 메일 발송
export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  // 1단계: 3개 배치를 병렬로 실행 (4분 타임아웃)
  let blogData = null;
  let cafeData = null;
  let reporterData = null;

  try {
    const batchPromise = Promise.allSettled([
      fetch(`${baseUrl}/api/batch-track`, { method: "POST" }),
      fetch(`${baseUrl}/api/cafe/batch-track`, { method: "POST" }),
      fetch(`${baseUrl}/api/reporter/batch-track`, { method: "POST" }),
    ]);

    const result = await Promise.race([batchPromise, timeout(BATCH_TIMEOUT_MS)]);

    if (result === "timeout") {
      blogData = { error: "배치 타임아웃 (4분 초과)" };
      cafeData = { error: "배치 타임아웃 (4분 초과)" };
      reporterData = { error: "배치 타임아웃 (4분 초과)" };
    } else {
      const [blogResult, cafeResult, reporterResult] = result;

      blogData =
        blogResult.status === "fulfilled" && blogResult.value.ok
          ? await blogResult.value.json()
          : { error: "블로그 배치 실패" };

      cafeData =
        cafeResult.status === "fulfilled" && cafeResult.value.ok
          ? await cafeResult.value.json()
          : { error: "카페 배치 실패" };

      reporterData =
        reporterResult.status === "fulfilled" && reporterResult.value.ok
          ? await reporterResult.value.json()
          : { error: "블로그기자단 배치 실패" };
    }
  } catch (error) {
    console.error("daily-batch error:", error);
    blogData = { error: "배치 처리 중 오류" };
    cafeData = { error: "배치 처리 중 오류" };
    reporterData = { error: "배치 처리 중 오류" };
  }

  // 2단계: 배치 완료/타임아웃 후 메일 발송 (최신 데이터 반영)
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
}
