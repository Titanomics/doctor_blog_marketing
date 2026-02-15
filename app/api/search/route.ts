import { NextRequest, NextResponse } from "next/server";
import { parseViewSection } from "@/lib/parseNaver";
import type { ViewResult } from "@/lib/parseNaver";

interface SearchApiResponse {
  results: ViewResult[];
  found: ViewResult | null;
  foundRank: number | null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const keyword = searchParams.get("keyword");
  const blogUrl = searchParams.get("blogUrl");

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

    let found: ViewResult | null = null;
    if (blogUrl) {
      found = results.find((r) => r.link.includes(blogUrl.trim())) ?? null;
    }

    const responseData: SearchApiResponse = {
      results,
      found,
      foundRank: found ? found.rank : null,
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("검색 오류:", error);
    return NextResponse.json(
      { error: "검색 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
