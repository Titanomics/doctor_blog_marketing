// 네이버 게시물 URL 검증·식별. 사용자 입력 URL로 서버가 요청을 보내기 전에 반드시 거친다.
// 문자열 포함 검사 대신 URL을 파싱해 호스트를 정확히 비교한다 (SSRF 방지).

const BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const CAFE_HOSTS = new Set(["cafe.naver.com", "m.cafe.naver.com"]);
const SHORT_HOST = "naver.me";

const MAX_REDIRECTS = 3;
const RESOLVE_TIMEOUT_MS = 5000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0";

// https, 자격증명·포트 없는 URL만 통과. 스킴이 없으면 https로 간주, http는 https로 올린다.
function parseSafeUrl(input: string, base?: string): URL | null {
  let u: URL;
  try {
    const raw = input.trim();
    u = base
      ? new URL(raw, base)
      : new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") return null;
  if (u.username || u.password || u.port) return null;
  return u;
}

export type BlogPostRef = { blogId: string; logNo: string };
export type CafeArticleRef = { cafe: string; articleId: string };

function blogRefFromUrl(u: URL): BlogPostRef | null {
  if (!BLOG_HOSTS.has(u.hostname)) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
  if (m) return { blogId: m[1], logNo: m[2] };
  if (/^\/PostView\.(naver|nhn)$/i.test(u.pathname)) {
    const blogId = u.searchParams.get("blogId");
    const logNo = u.searchParams.get("logNo");
    if (blogId && /^[A-Za-z0-9_-]+$/.test(blogId) && logNo && /^\d+$/.test(logNo)) {
      return { blogId, logNo };
    }
  }
  return null;
}

function cafeRefFromUrl(u: URL): CafeArticleRef | null {
  if (!CAFE_HOSTS.has(u.hostname)) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
  return m ? { cafe: m[1], articleId: m[2] } : null;
}

// naver.me 단축 URL을 따라가 최종 URL을 돌려준다.
// 각 홉의 목적지는 naver.me / 블로그 / 카페 호스트만 허용하고, 전체 시간과 홉 수를 제한한다.
async function resolveShortUrl(start: URL): Promise<URL | null> {
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  let current = start;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (current.hostname !== SHORT_HOST) return current;
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": UA },
        cache: "no-store",
        signal,
      });
    } catch {
      return null;
    }
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return null;
    const next = parseSafeUrl(location, current.href);
    if (
      !next ||
      !(next.hostname === SHORT_HOST || BLOG_HOSTS.has(next.hostname) || CAFE_HOSTS.has(next.hostname))
    ) {
      return null;
    }
    current = next;
  }
  return current.hostname === SHORT_HOST ? null : current;
}

async function toFinalUrl(input: string): Promise<URL | null> {
  const u = parseSafeUrl(input);
  if (!u) return null;
  return u.hostname === SHORT_HOST ? resolveShortUrl(u) : u;
}

// 블로그 글 URL(직접 또는 naver.me) → { blogId, logNo }. 그 외는 null.
export async function resolveBlogPost(input: string): Promise<BlogPostRef | null> {
  const u = await toFinalUrl(input);
  return u ? blogRefFromUrl(u) : null;
}

// 카페 글 URL(직접 또는 naver.me) → { cafe, articleId }. 그 외는 null.
export async function resolveCafeArticle(input: string): Promise<CafeArticleRef | null> {
  const u = await toFinalUrl(input);
  return u ? cafeRefFromUrl(u) : null;
}
