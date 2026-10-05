import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { loadModeHealth } from "@/lib/health";
import { getKSTDateString } from "@/lib/dateUtils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/health?mode=blog|cafe — 수집 상태 요약
// blog: 블로그 순위 수집 / cafe: 카페·기자단 순위 수집 + 카페 글 조회수 수집
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "cafe" ? "cafe" : "blog";

  if (mode === "blog") {
    return NextResponse.json({ modes: [await loadModeHealth("blog")] }, { headers: { "Cache-Control": "no-store" } });
  }

  const [cafe, reporter] = await Promise.all([loadModeHealth("cafe"), loadModeHealth("reporter")]);

  // 카페 글 조회수 수집: 가장 최근 수집일의 관측 수
  let postStats: { date: string; isToday: boolean; observed: number; withViews: number; restricted: number; deleted: number } | null = null;
  const { data: head } = await supabase
    .from("cafe_post_stats")
    .select("tracked_date")
    .order("tracked_date", { ascending: false })
    .limit(1);
  const date: string | undefined = head?.[0]?.tracked_date;
  if (date) {
    const { data } = await supabase.from("cafe_post_stats").select("status, read_count").eq("tracked_date", date).limit(2000);
    const rows = data ?? [];
    postStats = {
      date,
      isToday: date === getKSTDateString(),
      observed: rows.length,
      withViews: rows.filter((r) => r.status === "alive" && r.read_count !== null).length,
      restricted: rows.filter((r) => r.status === "alive" && r.read_count === null).length,
      deleted: rows.filter((r) => r.status === "deleted").length,
    };
  }

  return NextResponse.json({ modes: [cafe, reporter], postStats }, { headers: { "Cache-Control": "no-store" } });
}
