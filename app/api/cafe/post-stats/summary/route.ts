import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  loadLatestPostStats,
  postKey,
  summarizePostStat,
  type KeywordPostStat,
} from "@/lib/cafePostStats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/cafe/post-stats/summary?clientId=UUID
// 브랜드의 키워드별 글 조회수 요약. 같은 글을 가리키는 키워드는 같은 값을 공유한다(합산하지 않음).
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId가 필요합니다." }, { status: 400 });
  }

  const { data: keywords, error } = await supabase
    .from("cafe_keywords")
    .select("id, post_url, post_cafe, post_article_id, post_ref_url")
    .eq("client_id", clientId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { latestDate, latest, previous, error: statsError } = await loadLatestPostStats();
  if (statsError) return NextResponse.json({ error: statsError }, { status: 500 });

  const stats: Record<string, KeywordPostStat> = {};
  for (const k of keywords ?? []) {
    // 매핑이 현재 post_url 기준일 때만 연결한다 (URL을 바꾼 뒤 옛 글의 통계가 붙지 않도록)
    if (!k.post_cafe || !k.post_article_id || k.post_ref_url !== k.post_url) continue;
    const key = postKey(k.post_cafe, k.post_article_id);
    const row = latest.get(key);
    if (row) stats[k.id] = summarizePostStat(row, previous.get(key));
  }

  return NextResponse.json({ latestDate, stats }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
