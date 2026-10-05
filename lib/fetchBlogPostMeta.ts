// 네이버 블로그 게시글 메타 fetch (발행일).
// PostView.naver HTML의 se_publishDate 마커에서 추출.
// 단축 URL(naver.me)은 redirect 따라가서 처리.

import { resolveBlogPost } from "@/lib/naverUrl";

export type BlogPostMeta = {
  publishedAt: string | null; // ISO timestamp 또는 null
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0";

// se_publishDate 라벨 파싱: "2026. 8. 21. 11:34" (KST) 또는 "N분 전"/"N시간 전"/"어제"
function parsePublishLabel(label: string): string | null {
  const abs = label.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2})/);
  if (abs) {
    const [, y, mo, d, h, mi] = abs;
    const pad = (s: string) => s.padStart(2, "0");
    const t = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:00+09:00`);
    return isNaN(t.getTime()) ? null : t.toISOString();
  }
  const min = label.match(/(\d+)\s*분\s*전/);
  if (min) return new Date(Date.now() - parseInt(min[1], 10) * 60000).toISOString();
  const hour = label.match(/(\d+)\s*시간\s*전/);
  if (hour) return new Date(Date.now() - parseInt(hour[1], 10) * 3600000).toISOString();
  if (label.includes("어제")) return new Date(Date.now() - 86400000).toISOString();
  return null;
}

export async function fetchBlogPostMeta(blogUrl: string): Promise<BlogPostMeta> {
  const empty: BlogPostMeta = { publishedAt: null };
  try {
    const parsed = await resolveBlogPost(blogUrl);
    if (!parsed) return empty;

    const pageUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(parsed.blogId)}&logNo=${encodeURIComponent(parsed.logNo)}`;
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return empty;

    const html = await res.text();
    const m = html.match(/se_publishDate[^>]*>([^<]+)</);
    if (!m) return empty;
    return { publishedAt: parsePublishLabel(m[1].trim()) };
  } catch {
    return empty;
  }
}
