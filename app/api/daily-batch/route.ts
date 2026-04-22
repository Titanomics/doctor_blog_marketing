import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// 배치만 실행 (메일은 별도 크론으로 분리)
// Hobby 플랜 대응: 배치를 발사만 하고 즉시 응답
export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  const batchUrls = [
    `${baseUrl}/api/batch-track`,
    `${baseUrl}/api/cafe/batch-track`,
    `${baseUrl}/api/reporter/batch-track`,
  ];

  for (const url of batchUrls) {
    fetch(url, { method: "POST" }).catch(() => {});
  }

  // HTTP 요청이 전송될 시간 확보 (함수 종료 전에 요청이 나가야 target 함수가 실행됨)
  await new Promise((r) => setTimeout(r, 3000));

  return NextResponse.json({
    success: true,
    message: "배치 실행 시작 (블로그/카페/기자단)",
  });
}
