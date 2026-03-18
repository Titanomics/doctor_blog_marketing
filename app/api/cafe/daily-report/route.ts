import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateCafeReport } from "@/lib/generateCafeReport";
import { sendReportEmail, ReporterStatusChange, CafeKeywordSummary } from "@/lib/sendReportEmail";
import { getKSTDateString, getKSTYesterdayString } from "@/lib/dateUtils";

async function fetchAllKeywordsFromDB() {
  const { data: clients } = await supabase
    .from("cafe_clients")
    .select("id, name");

  if (!clients || clients.length === 0) return [];

  const result: Array<{
    clientName: string;
    keyword: string;
    current_rank: number | null;
    previous_rank: number | null;
    post_url: string | null;
    post_title: string | null;
    matched_url: string | null;
  }> = [];

  for (const client of clients) {
    const { data: keywords } = await supabase
      .from("cafe_keywords")
      .select("keyword, current_rank, previous_rank, post_url, post_title, matched_url")
      .eq("client_id", client.id);

    if (!keywords) continue;

    for (const kw of keywords) {
      result.push({
        clientName: client.name,
        keyword: kw.keyword,
        current_rank: kw.current_rank,
        previous_rank: kw.previous_rank,
        post_url: kw.post_url,
        post_title: kw.post_title,
        matched_url: kw.matched_url,
      });
    }
  }

  return result;
}

async function fetchReporterStatusChanges(): Promise<{
  newlyExposed: ReporterStatusChange[];
  newlyUnexposed: ReporterStatusChange[];
}> {
  // 오늘/어제 날짜 (KST 기준)
  const today = getKSTDateString();
  const yesterday = getKSTYesterdayString();

  // 오늘 & 어제 히스토리 조회
  const [{ data: todayHist }, { data: yesterdayHist }] = await Promise.all([
    supabase.from("reporter_blog_history").select("entry_id, rank").eq("tracked_date", today),
    supabase.from("reporter_blog_history").select("entry_id, rank").eq("tracked_date", yesterday),
  ]);

  if (!todayHist || todayHist.length === 0) return { newlyExposed: [], newlyUnexposed: [] };

  // 어제 기록이 없는 entry는 최초 등록이므로 제외
  const yesterdayMap = new Map((yesterdayHist ?? []).map((h) => [h.entry_id, h.rank]));

  const changed = todayHist.filter((t) => {
    if (!yesterdayMap.has(t.entry_id)) return false; // 어제 기록 없으면 제외
    const wasNull = yesterdayMap.get(t.entry_id) === null;
    const isNull = t.rank === null;
    return wasNull !== isNull; // 상태가 바뀐 경우만
  });

  if (changed.length === 0) return { newlyExposed: [], newlyUnexposed: [] };

  // entry → keyword → client 조회
  const entryIds = changed.map((c) => c.entry_id);
  const { data: entries } = await supabase
    .from("reporter_blog_entries")
    .select("id, blog_url, keyword_id")
    .in("id", entryIds);

  if (!entries || entries.length === 0) return { newlyExposed: [], newlyUnexposed: [] };

  const kwIds = [...new Set(entries.map((e) => e.keyword_id))];
  const { data: keywords } = await supabase
    .from("reporter_keywords")
    .select("id, keyword, client_id")
    .in("id", kwIds);

  const clientIds = [...new Set((keywords ?? []).map((k) => k.client_id))];
  const { data: clients } = await supabase
    .from("cafe_clients")
    .select("id, name")
    .in("id", clientIds);

  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const kwMap = new Map((keywords ?? []).map((k) => [k.id, k]));
  const clientMap = new Map((clients ?? []).map((c) => [c.id, c.name]));

  const newlyExposed: ReporterStatusChange[] = [];
  const newlyUnexposed: ReporterStatusChange[] = [];

  for (const hist of changed) {
    const entry = entryMap.get(hist.entry_id);
    if (!entry) continue;
    const kw = kwMap.get(entry.keyword_id);
    if (!kw) continue;
    const item: ReporterStatusChange = {
      clientName: clientMap.get(kw.client_id) ?? "",
      keyword: kw.keyword,
      blogUrl: entry.blog_url,
      previousRank: yesterdayMap.get(hist.entry_id) ?? null,
      currentRank: hist.rank,
    };
    if (hist.rank !== null) newlyExposed.push(item);
    else newlyUnexposed.push(item);
  }

  return { newlyExposed, newlyUnexposed };
}

// Vercel Cron은 GET으로 호출하므로 GET도 동일 로직으로 처리
export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}

async function handler(request: NextRequest) {
  // Vercel Cron 또는 Bearer 토큰 인증
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const date = getKSTDateString();

    const [keywords, reporterChanges] = await Promise.all([
      fetchAllKeywordsFromDB(),
      fetchReporterStatusChanges(),
    ]);
    const excelBuffer = generateCafeReport(keywords, date);
    await sendReportEmail(excelBuffer, date, reporterChanges, keywords);

    const exposed = keywords.filter((k: { current_rank: number | null }) => k.current_rank !== null).length;
    const unexposed = keywords.filter((k: { current_rank: number | null }) => k.current_rank === null).length;

    return NextResponse.json({
      success: true,
      date,
      total: keywords.length,
      exposed,
      unexposed,
    });
  } catch (error) {
    console.error("Daily report error:", error);
    return NextResponse.json({ error: "리포트 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
