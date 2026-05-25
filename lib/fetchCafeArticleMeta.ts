// 카페 게시글 메타 fetch (작성일 등).
// 단축 URL(naver.me)도 redirect 따라가서 처리.

export type CafeArticleMeta = {
  publishedAt: string | null; // ISO timestamp 또는 null
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0";

async function resolveCafeUrl(postUrl: string): Promise<string | null> {
  // 1차: 직접 매치
  let m = postUrl.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (m) return postUrl;

  // 2차: naver.me 단축 URL이면 GET + redirect:follow → final URL 사용
  // (Vercel Node fetch에서 HEAD/manual은 location 헤더 못 잡는 케이스 있어 GET/follow가 robust)
  if (postUrl.includes("naver.me/")) {
    try {
      const r = await fetch(postUrl, {
        redirect: "follow",
        headers: { "User-Agent": UA },
      });
      // 응답 본문은 사용 안 함. r.url에 최종 URL이 들어옴
      m = r.url.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
      if (m) return r.url;
    } catch {
      // 다음 시도로
    }
  }
  return null;
}

export async function fetchCafeArticleMeta(postUrl: string): Promise<CafeArticleMeta> {
  const empty: CafeArticleMeta = { publishedAt: null };
  try {
    const resolved = await resolveCafeUrl(postUrl);
    if (!resolved) return empty;
    const m = resolved.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
    if (!m) return empty;
    const [, shortcut, articleId] = m;

    const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${shortcut}/articles/${articleId}?query=&menuId=0&useCafeId=false&requestFrom=A`;
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return empty;

    const data = await res.json();
    const ms = data?.result?.article?.writeDate;
    if (typeof ms === "number" && Number.isFinite(ms)) {
      return { publishedAt: new Date(ms).toISOString() };
    }
    return empty;
  } catch {
    return empty;
  }
}
