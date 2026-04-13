import { NextRequest, NextResponse } from "next/server";
import { parseViewSection, parseSmartBlocks, parseReplies } from "@/lib/parseNaver";
import type { ViewResult, SmartBlockResult, ReplyResult } from "@/lib/parseNaver";

interface CafeSearchApiResponse {
  results: ViewResult[];
  found: ViewResult | null;
  foundRank: number | null;
  smartBlockResults: SmartBlockResult[];
  foundInSmartBlock: SmartBlockResult | null;
  replyResults: ReplyResult[];
  foundInReply: ReplyResult | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const keyword = searchParams.get("keyword");
  const postUrl = searchParams.get("postUrl");
  const postTitle = searchParams.get("postTitle");

  if (!keyword) {
    return NextResponse.json(
      { error: "키워드를 입력해주세요." },
      { status: 400 }
    );
  }

  try {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodedKeyword}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `네이버 검색 오류: ${response.status}` },
        { status: response.status }
      );
    }

    const html = await response.text();
    const results = parseViewSection(html);
    const smartBlockResults = parseSmartBlocks(html);
    const replyResults = parseReplies(html);

    let found: ViewResult | null = null;
    let foundInSmartBlock: SmartBlockResult | null = null;
    let foundInReply: ReplyResult | null = null;

    if (postUrl || postTitle) {
      const normalize = (link: string) =>
        link.replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com");
      const normalizedPostUrl = postUrl
        ? postUrl.trim().replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com")
        : null;

      // 특정 게시글 URL(숫자 ID 포함)이 있으면 URL로만 매칭
      const hasSpecificPostId = normalizedPostUrl && /\/\d+/.test(normalizedPostUrl);

      const match = (r: { link: string; title?: string }) => {
        const urlMatch = normalizedPostUrl && normalize(r.link).includes(normalizedPostUrl);
        if (hasSpecificPostId) return !!urlMatch;
        if (urlMatch) return true;
        if (postTitle && "title" in r && r.title && r.title.toLowerCase().includes(postTitle.toLowerCase())) return true;
        return false;
      };

      const matchReply = (r: ReplyResult) => {
        const urlMatch = normalizedPostUrl && normalize(r.link).includes(normalizedPostUrl);
        if (hasSpecificPostId) return !!urlMatch;
        if (urlMatch) return true;
        if (postTitle && r.text.toLowerCase().includes(postTitle.toLowerCase())) return true;
        return false;
      };

      found = results.find(match) ?? null;
      foundInSmartBlock = smartBlockResults.find(match) ?? null;

      // VIEW/스마트블록에서 못 찾은 경우에만 꼬리글(.series) 매칭
      if (!found && !foundInSmartBlock) {
        foundInReply = replyResults.find(matchReply) ?? null;
      }
    }

    const responseData: CafeSearchApiResponse = {
      results,
      found,
      foundRank: found ? found.rank : null,
      smartBlockResults,
      foundInSmartBlock,
      replyResults,
      foundInReply,
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("카페 검색 오류:", error);
    return NextResponse.json(
      { error: "검색 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
