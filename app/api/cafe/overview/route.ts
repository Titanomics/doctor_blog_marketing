import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { loadLatestPostStats, postKey, summarizePostStat } from "@/lib/cafePostStats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DELETED_TITLE = "[삭제된 게시글]";

type KeywordRow = {
  id: string;
  client_id: string;
  keyword: string;
  post_url: string | null;
  cafe_name: string | null;
  current_rank: number | null;
  matched_title: string | null;
  is_reply: boolean;
  published_at: string | null;
  post_cafe: string | null;
  post_article_id: string | null;
  post_ref_url: string | null;
};

// GET /api/cafe/overview — 카페 전체 브랜드 요약 + 위닝 글 목록
// 위닝 = 글의 누적 조회수가 기준 이상. 글 하나당 한 줄이고, 그 글에 등록된 키워드를 함께 나열한다.
export async function GET() {
  const [{ data: clients, error: clientError }, keywordResult, stats] = await Promise.all([
    supabase.from("cafe_clients").select("id, name, assignee, created_at").order("name"),
    fetchAll<KeywordRow>((from, to) =>
      supabase
        .from("cafe_keywords")
        .select(
          "id, client_id, keyword, post_url, cafe_name, current_rank, matched_title, is_reply, published_at, post_cafe, post_article_id, post_ref_url"
        )
        .order("id", { ascending: true })
        .range(from, to)
    ),
    loadLatestPostStats(),
  ]);
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (keywordResult.error) return NextResponse.json({ error: keywordResult.error }, { status: 500 });

  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const summary = new Map(
    (clients ?? []).map((c) => [
      c.id,
      { client: c, total: 0, exposed: 0, reply: 0, deleted: 0, winningPosts: 0, restrictedPosts: 0 },
    ])
  );

  // 글 단위로 묶기
  type Post = {
    key: string;
    clientId: string;
    postUrl: string | null;
    cafeName: string | null;
    publishedAt: string | null;
    keywords: { keyword: string; rank: number | null; isReply: boolean }[];
  };
  const posts = new Map<string, Post>();

  for (const k of keywordResult.data) {
    const s = summary.get(k.client_id);
    if (!s) continue;
    s.total++;
    if (k.matched_title === DELETED_TITLE) s.deleted++;
    else if (k.is_reply) s.reply++;
    else if (k.current_rank !== null) s.exposed++;

    if (!k.post_cafe || !k.post_article_id || k.post_ref_url !== k.post_url) continue;
    const key = `${k.client_id}:${postKey(k.post_cafe, k.post_article_id)}`;
    let post = posts.get(key);
    if (!post) {
      post = {
        key: postKey(k.post_cafe, k.post_article_id),
        clientId: k.client_id,
        postUrl: k.post_url,
        cafeName: k.cafe_name,
        publishedAt: k.published_at,
        keywords: [],
      };
      posts.set(key, post);
    }
    post.keywords.push({ keyword: k.keyword, rank: k.current_rank, isReply: k.is_reply });
    post.cafeName ??= k.cafe_name;
    post.publishedAt ??= k.published_at;
  }

  const winning = [];
  for (const post of posts.values()) {
    const row = stats.latest.get(post.key);
    if (!row) continue;
    const stat = summarizePostStat(row, stats.previous.get(post.key));
    const s = summary.get(post.clientId)!;
    if (stat.restricted) s.restrictedPosts++;
    if (!stat.winning) continue;
    s.winningPosts++;
    winning.push({
      clientId: post.clientId,
      clientName: clientName.get(post.clientId) ?? "",
      postUrl: post.postUrl,
      cafeName: post.cafeName,
      publishedAt: post.publishedAt,
      keywords: post.keywords,
      readCount: stat.readCount!,
      commentCount: stat.commentCount,
      delta: stat.delta,
      memberCount: stat.memberCount,
    });
  }

  // 전날 대비 증가량이 있으면 그 순서, 없으면 누적 조회수 순서
  const hasDelta = winning.some((w) => w.delta !== null);
  winning.sort((a, b) =>
    hasDelta ? (b.delta ?? -1) - (a.delta ?? -1) || b.readCount - a.readCount : b.readCount - a.readCount
  );

  return NextResponse.json(
    {
      statsDate: stats.latestDate,
      statsError: stats.error,
      hasDelta,
      observedPosts: stats.latest.size,
      winning,
      clients: [...summary.values()],
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
