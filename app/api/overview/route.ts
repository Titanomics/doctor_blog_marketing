import { NextResponse } from "next/server";
import { loadBlogOverview } from "@/lib/blogOverview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/overview — 블로그 전체 병원 요약 + 조치 목록
export async function GET() {
  const result = await loadBlogOverview();
  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error ?? "요약을 만들지 못했습니다." }, { status: 500 });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
