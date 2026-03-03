import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveCafeHistory } from "@/lib/saveCafeHistory";
import { generateCafeReport } from "@/lib/generateCafeReport";
import { sendReportEmail, ReporterStatusChange } from "@/lib/sendReportEmail";

const DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllKeywordsWithRanks(baseUrl: string) {
  const { data: clients } = await supabase
    .from("cafe_clients")
    .select("id, name");

  if (!clients || clients.length === 0) return [];

  const result: Array<{
    clientName: string;
    keyword: string;
    current_rank: number | null;
    post_url: string | null;
    post_title: string | null;
    matched_url: string | null;
  }> = [];

  for (const client of clients) {
    const { data: keywords } = await supabase
      .from("cafe_keywords")
      .select("id, keyword, current_rank, post_url, post_title")
      .eq("client_id", client.id);

    if (!keywords) continue;

    for (const kw of keywords) {
      try {
        await sleep(DELAY_MS);

        const params = new URLSearchParams({ keyword: kw.keyword });
        if (kw.post_url) params.set("postUrl", kw.post_url);
        if (kw.post_title) params.set("postTitle", kw.post_title);

        const searchRes = await fetch(`${baseUrl}/api/cafe/search?${params.toString()}`);
        if (!searchRes.ok) {
          result.push({ clientName: client.name, keyword: kw.keyword, current_rank: kw.current_rank, post_url: kw.post_url, post_title: kw.post_title, matched_url: null });
          continue;
        }

        const data = await searchRes.json();
        const newRank: number | null = data.foundRank ?? null;
        const matchedUrl = data.found?.link ?? data.foundInSmartBlock?.link ?? null;

        await supabase
          .from("cafe_keywords")
          .update({
            previous_rank: kw.current_rank,
            current_rank: newRank,
            matched_title: data.found?.title ?? data.foundInSmartBlock?.title ?? null,
            matched_url: matchedUrl,
            smart_block_name: data.foundInSmartBlock?.blockName ?? null,
            smart_block_rank: data.foundInSmartBlock?.rank ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", kw.id);

        await saveCafeHistory(kw.id, newRank);

        result.push({ clientName: client.name, keyword: kw.keyword, current_rank: newRank, post_url: kw.post_url, post_title: kw.post_title, matched_url: matchedUrl });
      } catch {
        result.push({ clientName: client.name, keyword: kw.keyword, current_rank: null, post_url: kw.post_url, post_title: kw.post_title, matched_url: null });
      }
    }
  }

  return result;
}

async function fetchReporterStatusChanges(): Promise<{
  newlyExposed: ReporterStatusChange[];
  newlyUnexposed: ReporterStatusChange[];
}> {
  // 오늘/어제 날짜
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

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
    const baseUrl = request.nextUrl.origin;
    const date = new Date().toISOString().split("T")[0];

    const [keywords, reporterChanges] = await Promise.all([
      fetchAllKeywordsWithRanks(baseUrl),
      fetchReporterStatusChanges(),
    ]);
    const excelBuffer = generateCafeReport(keywords, date);
    await sendReportEmail(excelBuffer, date, reporterChanges);

    const exposed = keywords.filter((k) => k.current_rank !== null).length;
    const unexposed = keywords.filter((k) => k.current_rank === null).length;

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
