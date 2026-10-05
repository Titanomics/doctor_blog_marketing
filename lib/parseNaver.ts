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

function stripTags(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").trim();
}

// 태그와, 제목 끝에 붙는 접근성용 숨김 문구("새 창 열림")를 제거
function cleanTitle(raw: string): string {
  return stripTags(raw).replace(/새 창 열림\s*$/, "").trim();
}

export type SerpState = "ok" | "empty" | "invalid";

/**
 * 받아온 HTML이 정상 검색 결과인지 판정한다.
 * - ok:      결과를 1건 이상 파싱함
 * - empty:   정상 검색 페이지인데 웹문서·리뷰 영역이 아예 없음 (실제로 노출 대상 없음)
 * - invalid: 검색 페이지가 아니거나(차단·오류 페이지), 결과 영역 수에 비해 읽은 결과가 너무 적음(마크업 변경)
 * invalid일 때는 "미노출"로 저장하면 안 된다.
 *
 * 화면의 결과 항목마다 data-block-id="web/…" 또는 "review/…" 표식이 하나씩 붙는다.
 * 실측(2026-10, 27개 검색어)에서 읽은 결과 수는 표식 수의 0.94배 이상이었다.
 * 일부만 읽히면 순위가 당겨지거나 대상 글을 놓치므로, 크게 모자라면 invalid로 본다.
 */
const MIN_PARSED_RATIO = 0.7;

export function classifySerp(html: string, parsedCount: number): SerpState {
  if (!/id="main_pack"/.test(html)) return "invalid";
  const expected = (html.match(/data-block-id="(?:web|review)\//g) ?? []).length;
  if (expected === 0) return parsedCount > 0 ? "ok" : "empty";
  return parsedCount >= expected * MIN_PARSED_RATIO ? "ok" : "invalid";
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
    // 포함 여부는 기존과 같은 기준(숨김 문구 포함 원문 길이)으로 판단하고, 저장할 제목만 정리한다
    if (stripTags(match[2]).length < 3) continue;
    const rawText = cleanTitle(match[2]);
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
    if (stripTags(am[2]).length < 3) continue;
    const title = cleanTitle(am[2]);

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
 * 꼬리글 파싱
 * data-heatmap-target=".series" 링크만 사용
 * (fds-reply-box는 메인 글의 댓글 스니펫이므로 꼬리글이 아님)
 */
export function parseReplies(html: string): ReplyResult[] {
  const results: ReplyResult[] = [];
  const seen = new Set<string>();

  const pattern = /href="(https?:\/\/[^"]+)"[^>]*data-heatmap-target="\.series"[^>]*>[\s\S]*?<\/a>/g;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const link = m[1].replace(/\?art=.*$/, "");
    const textMatch = /sds-comps-text-type-body2[^>]*>([^<]+)/g.exec(m[0]);
    const text = textMatch ? textMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    if (!seen.has(link)) {
      seen.add(link);
      results.push({ link, text });
    }
  }

  return results;
}

