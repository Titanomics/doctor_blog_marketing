// 카페 게시글 메타 fetch (작성일 등).
// 단축 URL(naver.me)도 redirect 따라가서 처리.

import { resolveCafeArticle } from "@/lib/naverUrl";

export type CafeArticleMeta = {
  publishedAt: string | null; // ISO timestamp 또는 null
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0";

export async function fetchCafeArticleMeta(postUrl: string): Promise<CafeArticleMeta> {
  const empty: CafeArticleMeta = { publishedAt: null };
  try {
    const ref = await resolveCafeArticle(postUrl);
    if (!ref) return empty;
    const { cafe: shortcut, articleId } = ref;

    // v3 엔드포인트는 2026-10 현재 모든 요청에 500을 반환한다. v2.1은 정상 동작.
    const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${shortcut}/articles/${articleId}?query=&useCafeId=false&requestFrom=A`;
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
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
