import { supabase } from "@/lib/supabase";
import type { ScanResultItem } from "@/lib/mentionScanRun";
import { toVerdict, type AutoScanVerdict } from "@/lib/autoScanVerdict";

export type { AutoScanVerdict, AutoScanSide, AutoScanRecord } from "@/lib/autoScanVerdict";
import type { AutoScanRecord } from "@/lib/autoScanVerdict";

// 미노출 키워드 자동 확인.
// 우리 글이 안 뜨는 키워드마다 "그 검색 결과에 솔커트 글이 있긴 한가"를 매일 본다.
// 자리를 차지한 다른 글은 기록하지 않고, 우리 제품 글(등록된 우리 글 또는 제품을 알리는 언급 글)의 유무와 순위만 남긴다.
// 기록은 mention_scans 에 summary.auto = true 로 저장한다 (별도 테이블 없음).

export async function loadAutoScans(date: string): Promise<AutoScanRecord[]> {
  const { data, error } = await supabase
    .from("mention_scans")
    .select("keyword, scanned_at, summary, results")
    .eq("kst_date", date)
    .eq("summary->>auto", "true")
    .order("scanned_at", { ascending: false });
  if (error || !data) return [];
  // 같은 날 두 번 돌았으면 최신 것만
  const seen = new Set<string>();
  const out: AutoScanRecord[] = [];
  for (const row of data) {
    if (seen.has(row.keyword)) continue;
    seen.add(row.keyword);
    const summary = row.summary as AutoScanRecord["summary"];
    out.push({
      keyword: row.keyword,
      sides: Array.isArray(summary.sides) ? summary.sides : [],
      scannedAt: row.scanned_at,
      summary,
      results: (row.results as ScanResultItem[]) ?? [],
    });
  }
  return out;
}

// 가장 최근 자동 스캔 날짜 (대시보드용)
export async function latestAutoScanDate(): Promise<string | null> {
  const { data } = await supabase
    .from("mention_scans")
    .select("kst_date")
    .eq("summary->>auto", "true")
    .order("kst_date", { ascending: false })
    .limit(1);
  return (data?.[0]?.kst_date as string | undefined) ?? null;
}

export interface AutoScanOverview {
  date: string | null;
  verdicts: AutoScanVerdict[];
  found: AutoScanVerdict[];
  none: AutoScanVerdict[];
  unreadable: AutoScanVerdict[];
  newlyFound: Set<string>; // 전날 스캔에서는 없었는데 오늘 있음으로 바뀐 키워드
}

export async function loadAutoScanOverview(date: string | null, previousDate: string | null): Promise<AutoScanOverview> {
  if (!date) return { date: null, verdicts: [], found: [], none: [], unreadable: [], newlyFound: new Set() };
  const [today, prev] = await Promise.all([loadAutoScans(date), previousDate ? loadAutoScans(previousDate) : Promise.resolve([])]);
  const verdicts = today.map(toVerdict).sort((a, b) => (a.bestRank ?? 999) - (b.bestRank ?? 999) || a.keyword.localeCompare(b.keyword, "ko"));
  const prevFound = new Set(prev.map(toVerdict).filter((v) => v.status === "found").map((v) => v.keyword));
  const prevScanned = new Set(prev.map((r) => r.keyword));
  const found = verdicts.filter((v) => v.status === "found");
  return {
    date,
    verdicts,
    found,
    none: verdicts.filter((v) => v.status === "none"),
    unreadable: verdicts.filter((v) => v.status === "unreadable"),
    newlyFound: new Set(found.filter((v) => prevScanned.has(v.keyword) && !prevFound.has(v.keyword)).map((v) => v.keyword)),
  };
}
