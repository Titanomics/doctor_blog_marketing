// 카페 게시글 메타 fetch (작성일 등).
// checkCafePostDeleted의 자매 — 같은 API 호출이라 응답 중 다른 필드 추출.

export type CafeArticleMeta = {
  publishedAt: string | null; // ISO timestamp 또는 null
};

export async function fetchCafeArticleMeta(postUrl: string): Promise<CafeArticleMeta> {
  const empty: CafeArticleMeta = { publishedAt: null };
  try {
    const m = postUrl.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
    if (!m) return empty;
    const [, shortcut, articleId] = m;

    const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${shortcut}/articles/${articleId}?query=&menuId=0&useCafeId=false&requestFrom=A`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
      },
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
