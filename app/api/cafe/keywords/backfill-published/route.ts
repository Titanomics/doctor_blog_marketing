import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchCafeArticleMeta } from "@/lib/fetchCafeArticleMeta";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// 기존 키워드의 published_at 백필. 한 번 호출로 limit개 처리.
// 호출 예: POST /api/cafe/keywords/backfill-published?limit=50
// 인증: CRON_SECRET Bearer
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, parseInt(limitParam ?? "50", 10) || 50));

  const { data: rows, error } = await supabase
    .from("cafe_keywords")
    .select("id, post_url")
    .is("published_at", null)
    .not("post_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ processed: 0, updated: 0, message: "백필 대상 없음" });
  }

  let updated = 0;
  let extracted = 0;
  for (const row of rows) {
    if (!row.post_url) continue;
    const meta = await fetchCafeArticleMeta(row.post_url);
    if (meta.publishedAt) {
      extracted++;
      const { error: upErr } = await supabase
        .from("cafe_keywords")
        .update({ published_at: meta.publishedAt })
        .eq("id", row.id);
      if (!upErr) updated++;
    }
    // 1초 간격 (네이버 차단 회피)
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json({
    processed: rows.length,
    extracted,
    updated,
    message: `${rows.length}건 시도 → ${extracted}건 추출 → ${updated}건 저장`,
  });
}
