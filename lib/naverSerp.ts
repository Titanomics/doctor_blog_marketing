// 네이버 통합검색 결과 수집. 배치·수동 검색이 모두 이 함수를 쓴다.
// 수집 실패(HTTP 오류, 시간 초과, 차단·오류 페이지, 마크업 변경)와
// 정상 수집(결과가 0건인 경우 포함)을 구분해 돌려준다.

import {
  classifySerp,
  parseSmartBlocks,
  parseViewSection,
  type SmartBlockResult,
  type ViewResult,
} from "@/lib/parseNaver";

// 응답 본문 읽기까지 포함한 전체 제한 시간
const SERP_TIMEOUT_MS = 12000;

export type SerpFetch =
  | { ok: true; html: string; results: ViewResult[]; smartBlockResults: SmartBlockResult[] }
  | { ok: false; reason: string; status: number };

export async function fetchNaverSerp(keyword: string): Promise<SerpFetch> {
  const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(keyword)}`;

  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(SERP_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: `네이버 검색 실패 (HTTP ${response.status})`, status: 502 };
    }
    html = await response.text();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      reason: timedOut ? "네이버 검색 시간 초과" : "네이버 검색 요청 오류",
      status: 504,
    };
  }

  const results = parseViewSection(html);
  const smartBlockResults = parseSmartBlocks(html);

  if (classifySerp(html, results.length + smartBlockResults.length) === "invalid") {
    console.warn(`[SERP-INVALID] "${keyword}" | HTML길이=${html.length}`);
    return {
      ok: false,
      reason: "검색 결과를 읽지 못함 (차단 또는 화면 구조 변경 의심)",
      status: 502,
    };
  }

  return { ok: true, html, results, smartBlockResults };
}
