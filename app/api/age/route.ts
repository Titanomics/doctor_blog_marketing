import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { loadAgeInfo, type AgeInfo, type AgeSource } from "@/lib/ageData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/age?mode=cafe|reporter&clientId=UUID
// 브랜드의 카페 키워드(mode=cafe) 또는 블로그기자단 글(mode=reporter)별 발행 주차 정보.
// 응답 items 의 키: cafe = 키워드 id, reporter = 글(entry) id
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const mode = sp.get("mode") === "reporter" ? "reporter" : "cafe";
  if (!clientId) return NextResponse.json({ error: "clientId가 필요합니다." }, { status: 400 });

  let sources: AgeSource[] = [];
  if (mode === "cafe") {
    const { data, error } = await supabase
      .from("cafe_keywords")
      .select("id, published_at, created_at")
      .eq("client_id", clientId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    sources = data ?? [];
  } else {
    const { data: keywords, error } = await supabase.from("reporter_keywords").select("id").eq("client_id", clientId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ids = (keywords ?? []).map((k) => k.id);
    if (ids.length > 0) {
      const { data: entries, error: entryError } = await supabase
        .from("reporter_blog_entries")
        .select("id, published_at, created_at")
        .in("keyword_id", ids);
      if (entryError) return NextResponse.json({ error: entryError.message }, { status: 500 });
      sources = entries ?? [];
    }
  }

  const { today, items, error } = await loadAgeInfo(mode, sources);
  const out: Record<string, AgeInfo> = {};
  for (const [id, info] of items) out[id] = info;
  return NextResponse.json({ today, items: out, historyError: error }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
