import { NextRequest, NextResponse } from "next/server";
import { parseViewSection, parseSmartBlocks } from "@/lib/parseNaver";
import type { ViewResult, SmartBlockResult } from "@/lib/parseNaver";

interface CafeSearchApiResponse {
  results: ViewResult[];
  found: ViewResult | null;
  foundRank: number | null;
  smartBlockResults: SmartBlockResult[];
  foundInSmartBlock: SmartBlockResult | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const keyword = searchParams.get("keyword");
  const cafeUrl = searchParams.get("cafeUrl");

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

    let found: ViewResult | null = null;
    let foundInSmartBlock: SmartBlockResult | null = null;

    if (cafeUrl) {
      // m.cafe.naver.com → cafe.naver.com 정규화 후 매칭
      const normalizedUrl = cafeUrl.trim().replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com");
      const normalize = (link: string) => link.replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com");
      found = results.find((r) => normalize(r.link).includes(normalizedUrl)) ?? null;
      foundInSmartBlock =
        smartBlockResults.find((r) => normalize(r.link).includes(normalizedUrl)) ?? null;
    }

    const responseData: CafeSearchApiResponse = {
      results,
      found,
      foundRank: found ? found.rank : null,
      smartBlockResults,
      foundInSmartBlock,
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
