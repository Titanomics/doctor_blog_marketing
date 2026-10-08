import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { DEFAULT_TERMS, loadRegisteredPosts, saveScan, scanKeyword } from "@/lib/mentionScanRun";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

// 제품 언급 순위 스캔 (수동).
// POST /api/mention-scan  { keyword, terms: string[] }
//   키워드로 네이버 통합검색(PC)을 조회하고, 결과에 나온 블로그·카페 글의 본문을 읽어
//   제품명(terms)이 언급된 글이 화면 전체 순서로 몇 번째인지 돌려준다.
// GET /api/mention-scan — 최근 스캔 기록 (자동 스캔 기록 제외)

export type { ScanResultItem } from "@/lib/mentionScanRun";

function cleanTerms(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const terms = [...new Set(list.map((t) => String(t).trim()).filter((t) => t.replace(/\s/g, "").length >= 2))];
  return terms.slice(0, 10);
}

export async function POST(request: NextRequest) {
  let body: { keyword?: unknown; terms?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword || keyword.length > 100) {
    return NextResponse.json({ error: "키워드를 입력해주세요." }, { status: 400 });
  }
  const terms = cleanTerms(body.terms);
  const useTerms = terms.length ? terms : DEFAULT_TERMS;

  const registered = await loadRegisteredPosts();
  const scan = await scanKeyword(keyword, useTerms, registered);
  if (!scan.ok) return NextResponse.json({ error: scan.reason }, { status: scan.status });

  const { saved, scannedAt } = await saveScan(keyword, useTerms, scan.summary, scan.items);
  return NextResponse.json({ keyword, terms: useTerms, scannedAt, summary: scan.summary, items: scan.items, cachedPosts: scan.cachedPosts, saved });
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) {
    const { data, error } = await supabase
      .from("mention_scans")
      .select("id, keyword, terms, scanned_at, summary, results")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({
      keyword: data.keyword,
      terms: data.terms,
      scannedAt: data.scanned_at,
      summary: data.summary,
      items: data.results,
    });
  }

  // 자동 스캔(summary.auto)은 매일 수십 건씩 쌓이므로 수동 기록 목록에서는 뺀다
  const { data, error } = await supabase
    .from("mention_scans")
    .select("id, keyword, terms, scanned_at, summary")
    .or("summary->>auto.is.null,summary->>auto.neq.true")
    .order("scanned_at", { ascending: false })
    .limit(40);
  if (error) return NextResponse.json({ scans: [], available: false });
  return NextResponse.json({ scans: data ?? [], available: true }, { headers: { "Cache-Control": "no-store" } });
}
