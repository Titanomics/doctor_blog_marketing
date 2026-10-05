// 검색 결과에 나온 블로그·카페 글의 제목·본문(·댓글)을 가져온다.
// 주소는 검색 결과에서 뽑은 식별자(BlogRef / CafeRef)로만 만들기 때문에 네이버 밖으로는 요청하지 않는다.
//
// 한 번 읽은 글은 scanned_posts 테이블에 보관해 다시 요청하지 않는다 (테이블이 없으면 매번 읽는다).

import { supabase } from "@/lib/supabase";
import { extractBlogContent, htmlToText, type PostContent } from "@/lib/mentionScan";

export type ContentStatus =
  | "ok"
  | "restricted" // 로그인·회원 가입이 필요한 글 (본문을 읽을 수 없음)
  | "deleted"
  | "unsupported" // 본문 형식을 읽지 못함 (구버전 편집기 등)
  | "failed"; // 일시 오류

export interface FetchedPost {
  status: ContentStatus;
  content: PostContent | null;
  cached: boolean;
}

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0";

// 읽은 글을 다시 쓰는 기간. 글이 수정될 수 있어 영구 보관하지 않는다.
const CACHE_DAYS: Record<ContentStatus, number> = { ok: 3, restricted: 1, deleted: 7, unsupported: 3, failed: 0 };

async function readCache(key: string): Promise<FetchedPost | null> {
  const { data, error } = await supabase
    .from("scanned_posts")
    .select("status, title, body, comments, fetched_at")
    .eq("post_key", key)
    .maybeSingle();
  if (error || !data) return null;
  const status = data.status as ContentStatus;
  const ageDays = (Date.now() - new Date(data.fetched_at).getTime()) / 86_400_000;
  if (ageDays > (CACHE_DAYS[status] ?? 0)) return null;
  return {
    status,
    cached: true,
    content: status === "ok" ? { title: data.title ?? "", body: data.body ?? "", comments: (data.comments as string[]) ?? [] } : null,
  };
}

async function writeCache(key: string, kind: "blog" | "cafe", post: FetchedPost) {
  if (post.status === "failed") return; // 일시 오류는 보관하지 않는다
  const { error } = await supabase.from("scanned_posts").upsert(
    {
      post_key: key,
      kind,
      status: post.status,
      title: post.content?.title ?? null,
      body: post.content?.body ?? null,
      comments: post.content?.comments ?? [],
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "post_key" }
  );
  if (error) console.warn(`[scanned_posts] 보관 실패: ${error.message}`);
}

async function fetchBlog(blogId: string, logNo: string): Promise<FetchedPost> {
  try {
    const res = await fetch(`https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`, {
      headers: { "User-Agent": UA_MOBILE, "Accept-Language": "ko-KR,ko;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return { status: "deleted", content: null, cached: false };
    if (!res.ok) return { status: "failed", content: null, cached: false };
    const html = await res.text();
    const extracted = extractBlogContent(html);
    if (!extracted) {
      const gone = /삭제되었거나|존재하지 않는|비공개/.test(html);
      return { status: gone ? "deleted" : "unsupported", content: null, cached: false };
    }
    return { status: "ok", content: { ...extracted, comments: [] }, cached: false };
  } catch {
    return { status: "failed", content: null, cached: false };
  }
}

async function fetchCafe(cafe: string, articleId: string): Promise<FetchedPost> {
  try {
    const res = await fetch(
      `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${encodeURIComponent(cafe)}/articles/${encodeURIComponent(articleId)}?query=&useCafeId=false&requestFrom=A`,
      { headers: { "User-Agent": UA_PC }, cache: "no-store", signal: AbortSignal.timeout(10000) }
    );
    if (res.status === 200) {
      const result = (await res.json())?.result;
      const article = result?.article;
      if (!article) return { status: "failed", content: null, cached: false };
      // 댓글은 첫 페이지만 본다
      const comments = ((result?.comments?.items ?? []) as { content?: unknown }[])
        .map((c) => (typeof c.content === "string" ? htmlToText(c.content) : ""))
        .filter(Boolean);
      return {
        status: "ok",
        cached: false,
        content: { title: String(article.subject ?? ""), body: htmlToText(String(article.contentHtml ?? "")), comments },
      };
    }
    const code = (await res.json().catch(() => null))?.result?.errorCode;
    if (res.status === 401 && code === "0004") return { status: "restricted", content: null, cached: false };
    if (res.status === 404 && code === "4003") return { status: "deleted", content: null, cached: false };
    if (res.status === 403) return { status: "restricted", content: null, cached: false };
    return { status: "failed", content: null, cached: false };
  } catch {
    return { status: "failed", content: null, cached: false };
  }
}

export async function getBlogPost(blogId: string, logNo: string): Promise<FetchedPost> {
  const key = `blog:${blogId.toLowerCase()}/${logNo}`;
  const cached = await readCache(key);
  if (cached) return cached;
  const post = await fetchBlog(blogId, logNo);
  await writeCache(key, "blog", post);
  return post;
}

export async function getCafePost(cafe: string, articleId: string): Promise<FetchedPost> {
  const key = `cafe:${cafe.toLowerCase()}/${articleId}`;
  const cached = await readCache(key);
  if (cached) return cached;
  const post = await fetchCafe(cafe, articleId);
  await writeCache(key, "cafe", post);
  return post;
}
