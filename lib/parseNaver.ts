export interface ViewResult {
  rank: number;
  title: string;
  link: string;
}

export interface SmartBlockResult {
  rank: number;   // 블록 내 순위
  title: string;
  link: string;
  blockName: string;  // 예: "'대구심장내과' 인기글", "대구수성구심장내과"
}

export interface ReplyResult {
  link: string;
  text: string;
}

/**
 * 블로그 URL 매칭 - 여러 URL 형식을 유연하게 지원
 * - 직접: blog.naver.com/oenough/224181717584
 * - logNo 파라미터: blog.naver.com/oenough?logNo=224181717584
 * - 모바일: m.blog.naver.com/oenough/224181717584
 */
export function matchesBlogUrl(resultLink: string, blogUrl: string): boolean {
  const normalized = blogUrl.replace(/^https?:\/\//, "").trim();

  // 1차: 직접 포함
  if (resultLink.includes(normalized)) return true;

  // 2차: blogId/postId 파싱 후 대안 형식 매칭
  const path = normalized.replace(/^(?:www\.|m\.)?blog\.naver\.com\//, "").split("/");
  const blogId = path[0];
  const postId = path[1];

  if (blogId && postId && /^\d+$/.test(postId)) {
    if (resultLink.includes(`/${blogId}/`) && resultLink.includes(postId)) return true;
    if (resultLink.includes(`blogId=${blogId}`) && resultLink.includes(`logNo=${postId}`)) return true;
    if (resultLink.includes(`/${blogId}?`) && resultLink.includes(postId)) return true;
  }

  return false;
}

// HTML 엔티티 디코딩
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "");
}

export function parseViewSection(html: string): ViewResult[] {
  const results: ViewResult[] = [];

  const viewHtml = html;

  // .link 과 .imgtitlelink 모두 포함 (피처드 카드 포함)
  const headlinePattern =
    /href="(https?:\/\/[^"]+)"[^>]*data-heatmap-target="\.(?:link|imgtitlelink)"[^>]*><span[^>]*headline1[^>]*>([\s\S]*?)<\/span><\/a>/g;

  let match;
  const seen = new Set<string>();

  while ((match = headlinePattern.exec(viewHtml)) !== null) {
    const link = match[1];
    const rawText = match[2].replace(/<[^>]*>/g, "").trim();

    if (!rawText || rawText.length < 3) continue;
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

export function parseSmartBlocks(html: string): SmartBlockResult[] {
  const results: SmartBlockResult[] = [];

  // ugc 스마트블록 위치 탐색 (data-block-id="ugc/...")
  const blockPattern = /data-block-id="(ugc\/[^"]+)"/g;
  const blocks: Array<{ pos: number; blockId: string; blockName: string }> = [];

  let bm;
  while ((bm = blockPattern.exec(html)) !== null) {
    const blockId = bm[1];
    // 블록 제목은 data-block-id 이후 3000자 내에서 첫 h2 태그
    const lookAhead = html.substring(bm.index, bm.index + 3000);
    const titleMatch = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(lookAhead);
    const blockName = titleMatch
      ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]*>/g, "").trim())
      : blockId;
    blocks.push({ pos: bm.index, blockId, blockName });
  }

  if (blocks.length === 0) return [];

  // .link 과 .imgtitlelink 둘 다 headline1 span이 있는 링크 찾기
  const articlePattern =
    /href="(https?:\/\/(?:blog|(?:m\.)?cafe)\.naver\.com\/[^"]+)"[^>]*data-heatmap-target="\.(?:link|imgtitlelink)"[^>]*><span[^>]*headline1[^>]*>([\s\S]*?)<\/span><\/a>/g;

  // 블록별 articles 그룹화
  const byBlock = new Map<
    string,
    { blockName: string; articles: Array<{ link: string; title: string }> }
  >();

  let am;
  while ((am = articlePattern.exec(html)) !== null) {
    const link = am[1];
    const title = am[2].replace(/<[^>]*>/g, "").trim();
    if (!title || title.length < 3) continue;

    const articlePos = am.index;

    // 이 기사가 속한 블록 찾기 (position 기준으로 가장 가까운 이전 블록)
    let blockName = "";
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].pos <= articlePos) {
        blockName = blocks[i].blockName;
        break;
      }
    }
    if (!blockName) continue;

    if (!byBlock.has(blockName)) {
      byBlock.set(blockName, { blockName, articles: [] });
    }
    const blockData = byBlock.get(blockName)!;
    // 중복 URL 제거
    if (!blockData.articles.some((a) => a.link === link)) {
      blockData.articles.push({ link, title });
    }
  }

  // 블록별로 순위 부여
  for (const { blockName, articles } of byBlock.values()) {
    articles.forEach((article, idx) => {
      results.push({
        rank: idx + 1,
        title: article.title,
        link: article.link,
        blockName,
      });
    });
  }

  return results;
}

/**
 * 꼬리글(댓글 스니펫) 파싱 - fds-reply-box 클래스의 링크들
 * 스마트블록 메인 글 아래 RE 태그로 표시되는 댓글 영역
 */
export function parseReplies(html: string): ReplyResult[] {
  const results: ReplyResult[] = [];
  const pattern = /href="(https?:\/\/[^"]+)"[^>]*fds-reply-box[^>]*>[\s\S]*?<\/a>/g;
  let m;
  const seen = new Set<string>();

  while ((m = pattern.exec(html)) !== null) {
    const fullLink = m[1];
    // URL에서 ?art= 파라미터 제거하여 기본 카페 URL만 추출
    const link = fullLink.replace(/\?art=.*$/, "");
    const textMatch = /sds-comps-text-type-body2[^>]*>([^<]+)</g.exec(m[0]);
    const text = textMatch ? textMatch[1].trim() : "";

    if (!seen.has(link)) {
      seen.add(link);
      results.push({ link, text });
    }
  }

  return results;
}

function extractViewSection(html: string): string | null {
  const viewRootPattern = /class="[^"]*_fe_view_root[^"]*"/i;
  const m1 = viewRootPattern.exec(html);
  if (m1) return html.slice(m1.index, m1.index + 200000);

  const dataPattern = /(<(?:section|div)[^>]+data-section="view"[^>]*>)/i;
  const m2 = dataPattern.exec(html);
  if (m2) return html.slice(m2.index, m2.index + 200000);

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
