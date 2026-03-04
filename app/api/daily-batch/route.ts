import { NextRequest, NextResponse } from "next/server";

// 매일 KST 06:00 (UTC 21:00)에 블로그 + 카페 전체 키워드 자동 업데이트
export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  try {
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

    return NextResponse.json({
      success: true,
      blog: blogData,
      cafe: cafeData,
      reporter: reporterData,
    });
  } catch (error) {
    console.error("daily-batch error:", error);
    return NextResponse.json(
      { error: "배치 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
