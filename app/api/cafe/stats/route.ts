import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CafeBreakdown = {
  name: string;
  count: number;
  source: "user" | "unclassified";
};

type MonthStat = {
  month: string;
  label: string;
  total: number;
  cafes: CafeBreakdown[];
};

// KST 기준 YYYY-MM 추출
function toKstMonth(iso: string): string {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 오늘 KST 기준 최근 3개월 (오늘 포함)
function recentMonths(): { month: string; label: string }[] {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const out: { month: string; label: string }[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getUTCMonth() + 1}월`;
    out.push({ month: m, label });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId가 필요합니다." }, { status: 400 });
  }

  const months = recentMonths();
  const fromMonth = months[0].month;
  const fromDate = `${fromMonth}-01T00:00:00+09:00`;

  const { data, error } = await supabase
    .from("cafe_keywords")
    .select("cafe_name, created_at")
    .eq("client_id", clientId)
    .gte("created_at", new Date(fromDate).toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // month → cafeName → { count, source }
  const buckets: Map<string, Map<string, { count: number; source: CafeBreakdown["source"] }>> =
    new Map();
  for (const m of months) buckets.set(m.month, new Map());

  for (const row of data ?? []) {
    const month = toKstMonth(row.created_at);
    if (!buckets.has(month)) continue; // 3개월 범위 밖

    const userName = (row.cafe_name as string | null)?.trim();
    const name = userName || "미분류";
    const source: CafeBreakdown["source"] = userName ? "user" : "unclassified";

    const m = buckets.get(month)!;
    const entry = m.get(name) ?? { count: 0, source };
    entry.count += 1;
    m.set(name, entry);
  }

  const result: MonthStat[] = months.map(({ month, label }) => {
    const m = buckets.get(month)!;
    const cafes: CafeBreakdown[] = Array.from(m.entries())
      .map(([name, v]) => ({ name, count: v.count, source: v.source }))
      .sort((a, b) => b.count - a.count);
    const total = cafes.reduce((s, c) => s + c.count, 0);
    return { month, label, total, cafes };
  });

  return NextResponse.json(
    { months: result },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
