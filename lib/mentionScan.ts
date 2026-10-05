// 글 본문에서 우리 제품 언급을 찾아 "어떤 성격의 언급인지" 판정한다 (네트워크·DB 없음).
//
// 제품명이 제목에 없고 본문 중간부터 등장하는 글(다른 제품 후기로 시작해 우리 제품으로 넘어가는 글)이
// 많아서, 언급 횟수와 처음 등장하는 위치, 주변 표현을 함께 본다.

export interface PostContent {
  title: string;
  body: string; // 본문 텍스트 (줄바꿈으로 문단 구분)
  comments: string[]; // 카페 글의 댓글 (블로그는 빈 배열)
}

export type MentionLevel =
  | "main" // 제품 글: 제목에 있거나 앞부분부터 여러 번 다룸
  | "switch" // 전환형: 다른 주제로 시작해 중간부터 제품으로 넘어감
  | "light" // 짧은 추천: 1~2번 언급 + 추천·구매 표현
  | "passing" // 스쳐 지나간 언급
  | "comment_only" // 본문에는 없고 댓글에서만 언급
  | "none";

export const LEVEL_LABEL: Record<MentionLevel, string> = {
  main: "제품 글",
  switch: "전환형",
  light: "짧은 추천",
  passing: "스쳐 지나간 언급",
  comment_only: "댓글에서 언급",
  none: "언급 없음",
};

// 우리 제품을 실질적으로 알리는 글로 볼 수 있는 수준
export const PROMOTING_LEVELS: MentionLevel[] = ["main", "switch", "light", "comment_only"];

export interface MentionAnalysis {
  level: MentionLevel;
  label: string;
  count: number; // 본문 언급 횟수
  commentCount: number; // 댓글 언급 횟수
  inTitle: boolean;
  firstPosition: number | null; // 본문에서 처음 등장하는 위치 (0~1)
  recommendCue: boolean; // 언급 주변에 추천·구매 표현이 있음
  negativeCue: boolean; // 언급 바로 뒤에 부정 표현이 있음 — 사람이 확인해야 함
  snippets: string[]; // 근거 문장 (최대 3개)
}

const MAIN_MIN_COUNT = 3;
const SWITCH_START = 0.3; // 본문의 30% 이후에 처음 등장하면 "중간부터"로 본다
const CUE_WINDOW = 70;

const RECOMMEND =
  /추천|구매|주문|검색해|가격|\d[\d,]*\s*원|재구매|만족|정착|갈아탔|바꿨|바꿔|넘어왔|먹기\s*시작|먹고\s*있|효과/;
// 제품명 "뒤"에 오는 표현만 본다. 앞쪽은 보통 경쟁 제품 이야기라 오탐이 된다.
const NEGATIVE = /비추|별로|실망|환불|효과\s*(?:가|는|도)?\s*없|안\s*맞|후회|부작용이?\s*(?:있|심|생|나타)/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "솔 커트"처럼 띄어 쓴 표기도 잡도록 글자 사이 공백을 허용한다
export function termPattern(terms: string[]): RegExp | null {
  const parts = terms
    .map((t) => t.replace(/\s/g, ""))
    .filter((t) => t.length >= 2)
    .map((t) => [...t].map(escapeRegExp).join("\\s*"));
  return parts.length ? new RegExp(parts.join("|"), "gi") : null;
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + length + 45);
  const s = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${s}${end < text.length ? "…" : ""}`;
}

export function analyzeMentions(content: PostContent, terms: string[]): MentionAnalysis {
  const empty: MentionAnalysis = {
    level: "none",
    label: LEVEL_LABEL.none,
    count: 0,
    commentCount: 0,
    inTitle: false,
    firstPosition: null,
    recommendCue: false,
    negativeCue: false,
    snippets: [],
  };
  const pattern = termPattern(terms);
  if (!pattern) return empty;

  const title = content.title ?? "";
  // 본문이 제목을 그대로 반복하며 시작하는 경우(네이버 블로그) 그 부분은 위치 계산에서 뺀다
  let body = (content.body ?? "").trim();
  const t = title.trim();
  while (t && body.startsWith(t)) body = body.slice(t.length).trim();

  const inTitle = new RegExp(pattern.source, "i").test(title);
  const matches = [...body.matchAll(pattern)];
  const count = matches.length;

  let commentCount = 0;
  const commentSnippets: string[] = [];
  for (const c of content.comments ?? []) {
    const hits = [...c.matchAll(pattern)];
    commentCount += hits.length;
    if (hits.length && commentSnippets.length < 3) commentSnippets.push(`[댓글] ${snippetAround(c, hits[0].index!, hits[0][0].length)}`);
  }

  if (count === 0 && commentCount === 0 && !inTitle) return empty;

  let recommendCue = false;
  let negativeCue = false;
  for (const m of matches) {
    const i = m.index!;
    const around = body.slice(Math.max(0, i - CUE_WINDOW), i + m[0].length + CUE_WINDOW);
    const after = body.slice(i + m[0].length, i + m[0].length + CUE_WINDOW);
    if (RECOMMEND.test(around)) recommendCue = true;
    if (NEGATIVE.test(after)) negativeCue = true;
  }

  const firstPosition = count > 0 && body.length > 0 ? matches[0].index! / body.length : null;

  let level: MentionLevel;
  if (count === 0 && !inTitle) level = "comment_only";
  else if (inTitle) level = "main";
  else if (count >= MAIN_MIN_COUNT) level = firstPosition !== null && firstPosition >= SWITCH_START ? "switch" : "main";
  else level = recommendCue ? "light" : "passing";

  // 근거: 처음·중간·마지막 언급
  const picks = count <= 3 ? matches : [matches[0], matches[Math.floor(count / 2)], matches[count - 1]];
  const snippets = [...picks.map((m) => snippetAround(body, m.index!, m[0].length)), ...commentSnippets].slice(0, 3);

  return { level, label: LEVEL_LABEL[level], count, commentCount, inTitle, firstPosition, recommendCue, negativeCue, snippets };
}

// --- 네이버 블로그(모바일 페이지) HTML에서 제목·본문 추출 ---

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(?:br|\/p|\/div|\/li)[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/​/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// 스마트에디터 글은 문단마다 se-text-paragraph 클래스가 붙는다. 없으면(구버전 편집기) null.
export function extractBlogContent(html: string): { title: string; body: string } | null {
  const title = decodeEntities((html.match(/property="og:title"\s+content="([^"]*)"/) ?? [])[1] ?? "").trim();
  const paragraphs = [...html.matchAll(/<p[^>]*class="[^"]*se-text-paragraph[^"]*"[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => htmlToText(m[1]))
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return { title, body: paragraphs.join("\n") };
}
