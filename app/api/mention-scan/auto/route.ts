import { NextResponse } from "next/server";
import { latestAutoScanDate, loadAutoScanOverview } from "@/lib/autoScan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/mention-scan/auto — 가장 최근 자동 확인 결과 (대시보드용)
export async function GET() {
  const date = await latestAutoScanDate();
  const previous = date ? new Date(new Date(date + "T00:00:00Z").getTime() - 86_400_000).toISOString().slice(0, 10) : null;
  const overview = await loadAutoScanOverview(date, previous);
  return NextResponse.json(
    {
      date: overview.date,
      found: overview.found.map((v) => ({ ...v, newlyFound: overview.newlyFound.has(v.keyword) })),
      none: overview.none.map((v) => ({ keyword: v.keyword, sides: v.sides })),
      unreadable: overview.unreadable.map((v) => ({ keyword: v.keyword, sides: v.sides })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
