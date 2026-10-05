import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { parseBlogRef, parseCafeRef } from "@/lib/naverUrl";
import { getBlogPost, getCafePost, type ContentStatus } from "@/lib/postContent";
import { analyzeMentions, htmlToText, PROMOTING_LEVELS, type MentionAnalysis } from "@/lib/mentionScan";
import { fetchAll } from "@/lib/fetchAll";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

// 제품 언급 순위 스캔.
// POST /api/mention-scan  { keyword, terms: string[] }
//   키워드로 네이버 통합검색(PC)을 조회하고, 결과에 나온 블로그·카페 글의 본문을 읽어
//   제품명(terms)이 언급된 글이 화면 전체 순서로 몇 번째인지 돌려준다.
// GET /api/mention-scan — 최근 스캔 기록

const DEFAULT_TERMS = ["솔커트", "테르피노"];
const FETCH_CONCURRENCY = 3;
const STATUS_NOTE: Record<Exclude<ContentStatus, "ok">, string> = {
  restricted: "회원 전용 글 — 본문 확인 불가",
  deleted: "삭제된 글",
  unsupported: "본문 형식을 읽지 못함",
  failed: "본문 조회 실패",
};

export interface ScanResultItem {
  rank: number; // PC 통합검색 화면 전체 순서
  kind: "blog" | "cafe" | "web";
  title: string;
  link: string;
  note: string | null; // 본문을 분석하지 못한 이유
  analysis: MentionAnalysis | null;
  registered: string | null; // 대시보드에 등록된 우리 글이면 브랜드 이름
}

// 대시보드에 등록된 글 목록. 회원 전용이라 본문을 읽을 수 없는 카페 글도
// 등록된 글이면 "우리 글"로 표시할 수 있다.
async function loadRegisteredPosts(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: brands } = await supabase.from("cafe_clients").select("id, name");
  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name as string]));

  const cafe = await fetchAll<{ client_id: string; post_cafe: string | null; post_article_id: string | null }>((from, to) =>
    supabase
      .from("cafe_keywords")
      .select("client_id, post_cafe, post_article_id")
      .not("post_cafe", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
  for (const k of cafe.data) {
    if (k.post_cafe && k.post_article_id) map.set(`cafe:${k.post_cafe}/${k.post_article_id}`, brandName.get(k.client_id) ?? "등록 글");
  }

  // 기자단: 키워드 아래 등록된 블로그 글
  const { data: reporterKeywords } = await supabase.from("reporter_keywords").select("id, client_id");
  const keywordBrand = new Map((reporterKeywords ?? []).map((k) => [k.id, brandName.get(k.client_id) ?? "등록 글"]));
  const entries = await fetchAll<{ keyword_id: string; blog_url: string | null }>((from, to) =>
    supabase.from("reporter_blog_entries").select("keyword_id, blog_url").order("id", { ascending: true }).range(from, to)
  );
  for (const e of entries.data) {
    const ref = e.blog_url ? parseBlogRef(e.blog_url) : null;
    if (ref?.logNo) map.set(`blog:${ref.blogId.toLowerCase()}/${ref.logNo}`, keywordBrand.get(e.keyword_id) ?? "등록 글");
  }
  return map;
}

function registeredKey(link: string): string | null {
  const blog = parseBlogRef(link);
  if (blog?.logNo) return `blog:${blog.blogId.toLowerCase()}/${blog.logNo}`;
  const cafe = parseCafeRef(link);
  if (cafe?.cafe) return `cafe:${cafe.cafe}/${cafe.articleId}`;
  return null;
}

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

  const [serp, registered] = await Promise.all([fetchNaverSerp(keyword), loadRegisteredPosts()]);
  if (!serp.ok) return NextResponse.json({ error: serp.reason }, { status: serp.status });

  const items: ScanResultItem[] = serp.results.map((r) => {
    const key = registeredKey(r.link);
    return {
      rank: r.rank,
      kind: parseBlogRef(r.link)?.logNo ? "blog" : parseCafeRef(r.link) ? "cafe" : "web",
      title: htmlToText(r.title),
      link: r.link.replace(/&amp;/g, "&"),
      note: null,
      analysis: null,
      registered: key ? registered.get(key) ?? null : null,
    };
  });

  // 글 본문을 조금씩 나눠 읽는다 (한꺼번에 몰아서 요청하지 않음)
  const queue = items.filter((it) => it.kind !== "web");
  for (const it of items) if (it.kind === "web") it.note = "외부 사이트 — 분석 대상 아님";

  let cursor = 0;
  let cachedCount = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const it = queue[cursor++];
      let post;
      if (it.kind === "blog") {
        const ref = parseBlogRef(it.link)!;
        post = await getBlogPost(ref.blogId, ref.logNo!);
      } else {
        const ref = parseCafeRef(it.link)!;
        // 검색 결과의 카페 링크는 이름 형식이다. 숫자 ID만 있는 링크는 본문을 읽지 않는다.
        post = ref.cafe ? await getCafePost(ref.cafe, ref.articleId) : { status: "unsupported" as const, content: null, cached: false };
      }
      if (post.cached) cachedCount++;
      if (post.status === "ok" && post.content) {
        it.analysis = analyzeMentions(post.content, useTerms);
      } else if (post.status !== "ok") {
        it.note = STATUS_NOTE[post.status];
      }
      if (!post.cached) await new Promise((r) => setTimeout(r, 250));
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker));

  // 우리 제품을 알리는 글 = 본문에서 제품 언급이 확인된 글 + 대시보드에 등록된 우리 글
  const promoting = items.filter(
    (it) => it.registered || (it.analysis && PROMOTING_LEVELS.includes(it.analysis.level))
  );
  const mentioned = items.filter((it) => it.analysis && it.analysis.level !== "none");
  const summary = {
    total: items.length,
    analyzed: items.filter((it) => it.analysis).length,
    unreadable: queue.filter((it) => !it.analysis).length,
    mentioned: mentioned.length,
    promoting: promoting.length,
    registered: items.filter((it) => it.registered).length,
    bestRank: promoting.length ? Math.min(...promoting.map((it) => it.rank)) : null,
    ranks: promoting.map((it) => it.rank),
  };

  // 기록 (테이블이 없으면 건너뜀)
  const scannedAt = new Date().toISOString();
  const { error: saveError } = await supabase.from("mention_scans").insert({
    keyword,
    terms: useTerms,
    kst_date: getKSTDateString(),
    scanned_at: scannedAt,
    summary,
    results: items,
  });
  if (saveError) console.warn(`[mention_scans] 기록 실패: ${saveError.message}`);

  return NextResponse.json({ keyword, terms: useTerms, scannedAt, summary, items, cachedPosts: cachedCount, saved: !saveError });
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

  const { data, error } = await supabase
    .from("mention_scans")
    .select("id, keyword, terms, scanned_at, summary")
    .order("scanned_at", { ascending: false })
    .limit(40);
  if (error) return NextResponse.json({ scans: [], available: false });
  return NextResponse.json({ scans: data ?? [], available: true }, { headers: { "Cache-Control": "no-store" } });
}
