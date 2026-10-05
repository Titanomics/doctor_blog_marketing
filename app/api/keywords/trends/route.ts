import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { classifyTrend, recentKstDates, toDayValues } from "@/lib/trend";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAYS = 30;

// GET /api/keywords/trends?clientId=UUID
// 병원의 키워드별 최근 30일 순위 배열과 상태 분류.
// 하루 값: 양수 = 순위 / 0 = 수집했으나 미노출 / null = 수집 기록 없음
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId가 필요합니다." }, { status: 400 });
  }

  const { data: keywords, error: kwError } = await supabase
    .from("keywords")
    .select("id")
    .eq("client_id", clientId);
  if (kwError) return NextResponse.json({ error: kwError.message }, { status: 500 });

  const dates = recentKstDates(DAYS);
  const ids = (keywords ?? []).map((k) => k.id);
  const trends: Record<string, { days: (number | null)[]; status: string; observed: number; topDays: number }> = {};
  if (ids.length === 0) return NextResponse.json({ dates, trends });

  const { data: rows, error } = await fetchAll<{ keyword_id: string; rank: number | null; tracked_date: string }>(
    (from, to) =>
      supabase
        .from("keyword_history")
        .select("keyword_id, rank, tracked_date")
        .in("keyword_id", ids)
        .gte("tracked_date", dates[0])
        .order("tracked_date", { ascending: true })
        .order("keyword_id", { ascending: true })
        .range(from, to)
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  const byKeyword = new Map<string, { tracked_date: string; rank: number | null }[]>();
  for (const r of rows) {
    const list = byKeyword.get(r.keyword_id);
    if (list) list.push(r);
    else byKeyword.set(r.keyword_id, [r]);
  }

  for (const id of ids) {
    const days = toDayValues(dates, byKeyword.get(id) ?? []);
    trends[id] = { days, ...classifyTrend(days) };
  }

  return NextResponse.json({ dates, trends }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
