export interface ViewResult {
  rank: number;
  title: string;
  link: string;
}

export function parseViewSection(html: string): ViewResult[] {
  const results: ViewResult[] = [];

  // VIEW 섹션 추출 (여러 전략으로 fallback)
  const viewHtml =
    extractViewSection(html) ??
    html;

  // VIEW 섹션 내 모든 항목의 headline 링크 추출 (블로그+카페+기타 모두 포함)
  // 각 항목의 제목은 headline1 클래스 span 안에 있고, data-heatmap-target=".link" 속성의 <a> 태그
  const headlinePattern =
    /href="(https?:\/\/[^"]+)"[^>]*data-heatmap-target="\.link"[^>]*><span[^>]*headline1[^>]*>([\s\S]*?)<\/span><\/a>/g;

  let match;
  const seen = new Set<string>();

  while ((match = headlinePattern.exec(viewHtml)) !== null) {
    const link = match[1];
    const rawText = match[2].replace(/<[^>]*>/g, "").trim();

    if (!rawText || rawText.length < 3) continue;

    // 중복 제거
    if (seen.has(link)) continue;
    seen.add(link);

    results.push({
      rank: results.length + 1,
      title: rawText,
      link,
    });
  }

  return results;
}

function extractViewSection(html: string): string | null {
  // 전략 1: _fe_view_root 클래스 (네이버 통합검색 VIEW 섹션)
  const viewRootPattern = /class="[^"]*_fe_view_root[^"]*"/i;
  const m1 = viewRootPattern.exec(html);
  if (m1) return html.slice(m1.index, m1.index + 200000);

  // 전략 2: data-section="view" 속성
  const dataPattern = /(<(?:section|div)[^>]+data-section="view"[^>]*>)/i;
  const m2 = dataPattern.exec(html);
  if (m2) return html.slice(m2.index, m2.index + 200000);

  // 전략 3: sp_nviews 등 레거시 클래스
  const legacyPatterns = [
    /class="[^"]*sp_nviews[^"]*"/i,
    /class="[^"]*section_view[^"]*"/i,
  ];
  for (const p of legacyPatterns) {
    const m = p.exec(html);
    if (m) return html.slice(m.index, m.index + 200000);
  }

  return null;
}
