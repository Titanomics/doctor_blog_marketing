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
  if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);
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

// ---------------------------------------------------------------------------
// 검색 결과 링크 ↔ 등록 URL 매칭 (네트워크 없음)
// 문자열 포함이 아니라 블로그 ID·글 번호 / 카페·글 번호를 파싱해 완전일치로 비교한다.
// ---------------------------------------------------------------------------

// 검색 결과 HTML에서 뽑은 링크는 &amp; 가 그대로 남아 있다.
function decodeLink(link: string): string {
  return link.replace(/&amp;/g, "&");
}

// 블로그 홈(blog.naver.com/abc)이면 logNo = null, 글 URL이면 logNo 포함.
export type BlogRef = { blogId: string; logNo: string | null };

export function parseBlogRef(input: string): BlogRef | null {
  const u = parseSafeUrl(decodeLink(input));
  if (!u || !BLOG_HOSTS.has(u.hostname)) return null;
  const post = blogRefFromUrl(u);
  if (post) return post;
  const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);
  if (!m || /^PostView\./i.test(m[1])) return null;
  // blog.naver.com/abc?Redirect=Log&logNo=123 형식
  const logNo = u.searchParams.get("logNo");
  return { blogId: m[1], logNo: logNo && /^\d+$/.test(logNo) ? logNo : null };
}

// target이 블로그 홈이면 같은 블로그의 모든 글과, 글 URL이면 그 글 하나와만 일치.
export function matchesBlogUrl(resultLink: string, target: string): boolean {
  const t = parseBlogRef(target);
  const r = parseBlogRef(resultLink);
  if (!t || !r) return false;
  if (r.blogId.toLowerCase() !== t.blogId.toLowerCase()) return false;
  return t.logNo ? r.logNo === t.logNo : true;
}

// 카페 글. URL 형식에 따라 카페 이름(cafe) 또는 숫자 ID(clubId) 중 하나만 알 수 있다.
export type CafeRef = { cafe: string | null; clubId: string | null; articleId: string };

export function parseCafeRef(input: string): CafeRef | null {
  const u = parseSafeUrl(decodeLink(input));
  if (!u || !CAFE_HOSTS.has(u.hostname)) return null;
  let m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
  if (m) return { cafe: m[1].toLowerCase(), clubId: null, articleId: m[2] };
  // cafe.naver.com/f-e/cafes/{id}/articles/{n}, m.cafe.naver.com/ca-fe/web/cafes/{id}/articles/{n}
  m = u.pathname.match(/^\/(?:f-e|ca-fe)\/(?:web\/)?cafes\/([A-Za-z0-9_-]+)\/articles\/(\d+)\/?$/);
  if (m) {
    return /^\d+$/.test(m[1])
      ? { cafe: null, clubId: m[1], articleId: m[2] }
      : { cafe: m[1].toLowerCase(), clubId: null, articleId: m[2] };
  }
  if (/^\/ArticleRead\.nhn$/i.test(u.pathname)) {
    const clubId = u.searchParams.get("clubid");
    const articleId = u.searchParams.get("articleid");
    if (clubId && /^\d+$/.test(clubId) && articleId && /^\d+$/.test(articleId)) {
      return { cafe: null, clubId, articleId };
    }
  }
  return null;
}

// 글 번호와 카페 식별자가 모두 같아야 일치.
// 한쪽은 이름·한쪽은 숫자 ID뿐이면 같은 카페인지 대조할 수 없으므로 일치로 보지 않는다
// (글 번호만 같은 다른 카페 글을 잡는 것보다 못 찾는 편이 안전).
export function sameCafeArticle(a: CafeRef, b: CafeRef): boolean {
  if (a.articleId !== b.articleId) return false;
  if (a.clubId && b.clubId) return a.clubId === b.clubId;
  if (a.cafe && b.cafe) return a.cafe === b.cafe;
  return false;
}

// 숫자 카페 ID → 카페 이름. 성공한 결과만 하루 동안 기억한다 (실패는 기억하지 않음).
const CAFE_NAME_TTL_MS = 24 * 60 * 60 * 1000;
const cafeNameCache = new Map<string, { name: string; at: number }>();

// 반환: 카페 이름 / null(조회 실패 — 일시적일 수 있음)
async function lookupCafeName(clubId: string): Promise<string | null> {
  const hit = cafeNameCache.get(clubId);
  if (hit && Date.now() - hit.at < CAFE_NAME_TTL_MS) return hit.name;
  try {
    const res = await fetch(
      `https://apis.naver.com/cafe-web/cafe2/CafeGateInfo.json?cafeId=${clubId}`,
      { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const info = (await res.json())?.message?.result?.cafeInfoView;
    const name = info?.cafeUrl;
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]+$/.test(name)) return null;
    // 응답이 요청한 카페의 것인지 확인
    if (info.cafeId !== undefined && String(info.cafeId) !== clubId) return null;
    const lower = name.toLowerCase();
    cafeNameCache.set(clubId, { name: lower, at: Date.now() });
    return lower;
  } catch {
    return null;
  }
}

// 카페 이름을 아는 경우의 표준 URL (삭제 여부 확인 API용). 숫자 ID만 알면 null.
export function cafeRefToUrl(ref: CafeRef): string | null {
  return ref.cafe ? `https://cafe.naver.com/${ref.cafe}/${ref.articleId}` : null;
}

// 등록된 카페 글 URL(직접 또는 naver.me) → CafeRef.
// - null: URL이 없거나 카페 글 URL이 아님 (확정적 — 호출부는 제목 매칭으로 넘어가도 됨)
// - "unresolved": naver.me 해석이나 카페 이름 조회가 일시적 오류로 실패 (호출부는 저장을 보류해야 함)
// 숫자 카페 ID로만 등록된 URL은 카페 이름을 조회해 채운다 — 검색 결과 링크가 이름 형식이기 때문.
export async function resolveCafeTarget(
  postUrl: string | null | undefined
): Promise<CafeRef | null | "unresolved"> {
  if (!postUrl) return null;
  let ref = parseCafeRef(postUrl);
  if (!ref) {
    const u = parseSafeUrl(postUrl);
    if (!u || u.hostname !== SHORT_HOST) return null;
    const resolved = await resolveShortUrl(u);
    if (resolved === "error") return "unresolved";
    ref = resolved ? parseCafeRef(resolved.href) : null;
    if (!ref) return null;
  }
  if (!ref.cafe && ref.clubId) {
    const name = await lookupCafeName(ref.clubId);
    if (!name) return "unresolved";
    ref = { ...ref, cafe: name };
  }
  return ref;
}

// naver.me 단축 URL을 따라가 최종 URL을 돌려준다.
// 각 홉의 목적지는 naver.me / 블로그 / 카페 호스트만 허용하고, 전체 시간과 홉 수를 제한한다.
// 반환: 최종 URL / null(리다이렉트가 아니거나 허용되지 않은 목적지 — 확정적) /
//       "error"(네트워크 오류·시간 초과 — 일시적일 수 있어 호출부가 판단을 보류해야 함)
async function resolveShortUrl(start: URL): Promise<URL | null | "error"> {
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
      return "error";
    }
    if (res.status >= 500 || res.status === 429) {
      await res.body?.cancel().catch(() => {});
      return "error";
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
  if (u.hostname !== SHORT_HOST) return u;
  const resolved = await resolveShortUrl(u);
  return resolved === "error" ? null : resolved;
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
