import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isJobAuthorization } from "@/lib/auth";
import { getKSTDateString } from "@/lib/dateUtils";
import { loadProductOverview } from "@/lib/productOverview";
import { DEFAULT_TERMS, loadRegisteredPosts, saveScan, scanKeyword } from "@/lib/mentionScanRun";
import type { AutoScanSide } from "@/lib/autoScan";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// 미노출 키워드 자동 확인 (배치 전용).
// POST /api/mention-scan/auto/run?limit=15
//   제품 브랜드(SLACK_ALERT_BRANDS, 기본 솔커트)의 카페·기자단 키워드 중 오늘 미노출인 것을 골라
//   한 키워드씩 스캔하고 mention_scans 에 summary.auto = true 로 기록한다.
//   오늘 이미 스캔한 키워드는 건너뛰므로, 남은 것이 0이 될 때까지 반복 호출하면 된다.
// 응답에는 숫자만 담는다 (공개 저장소의 Actions 로그에 키워드가 남지 않게).

const TIME_BUDGET_MS = 230_000;
const KEYWORD_INTERVAL_MS = 1500;
const MAX_CONSECUTIVE_SERP_FAILURES = 5;

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || !isJobAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(50, parseInt(request.nextUrl.searchParams.get("limit") ?? "15", 10) || 15));
  const today = getKSTDateString();

  const prefixes = (process.env.SLACK_ALERT_BRANDS ?? "솔커트")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const product = await loadProductOverview(prefixes);
  if (product.error) return NextResponse.json({ error: product.error }, { status: 500 });

  // 미노출 키워드 (삭제된 글·꼬리글은 unexposed 에서 이미 빠져 있다). 같은 키워드가 양쪽에 있으면 한 번만 본다.
  const targets = new Map<string, Set<AutoScanSide>>();
  for (const [side, rows] of [
    ["cafe", product.cafe.unexposed],
    ["reporter", product.reporter.unexposed],
  ] as const) {
    for (const r of rows) {
      const kw = r.keyword.trim();
      if (!kw) continue;
      if (!targets.has(kw)) targets.set(kw, new Set());
      targets.get(kw)!.add(side);
    }
  }

  const { data: doneRows, error: doneError } = await supabase
    .from("mention_scans")
    .select("keyword")
    .eq("kst_date", today)
    .eq("summary->>auto", "true");
  if (doneError) return NextResponse.json({ error: `기록 조회 실패: ${doneError.message}` }, { status: 500 });
  const done = new Set((doneRows ?? []).map((r) => r.keyword as string));

  const pending = [...targets.entries()].filter(([kw]) => !done.has(kw));
  const registered = await loadRegisteredPosts();

  let processed = 0;
  let saved = 0;
  let failed = 0;
  let found = 0;
  let consecutiveSerpFailures = 0;
  let stopped: string | null = null;

  for (const [keyword, sides] of pending) {
    if (processed >= limit) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      stopped = "time_budget";
      break;
    }
    if (processed > 0) await new Promise((r) => setTimeout(r, KEYWORD_INTERVAL_MS));
    processed++;

    const scan = await scanKeyword(keyword, DEFAULT_TERMS, registered);
    if (!scan.ok) {
      failed++;
      if (++consecutiveSerpFailures >= MAX_CONSECUTIVE_SERP_FAILURES) {
        stopped = "consecutive_failures";
        break;
      }
      continue;
    }
    consecutiveSerpFailures = 0;
    const result = await saveScan(keyword, DEFAULT_TERMS, scan.summary, scan.items, { auto: true, sides: [...sides] });
    if (result.saved) {
      saved++;
      if (scan.summary.promoting > 0) found++;
    } else {
      failed++;
      // 기록이 안 되면 다음 호출에서 같은 키워드를 또 스캔하므로 멈춘다
      stopped = `save_failed: ${result.error}`;
      break;
    }
  }

  return NextResponse.json({
    date: today,
    targets: targets.size,
    alreadyDone: targets.size - pending.length,
    processed,
    saved,
    failed,
    found,
    remaining: pending.length - saved,
    stopped,
    elapsedMs: Date.now() - startedAt,
  });
}
