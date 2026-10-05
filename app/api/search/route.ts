import { NextRequest, NextResponse } from "next/server";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { matchesBlogUrl } from "@/lib/naverUrl";
import type { ViewResult, SmartBlockResult } from "@/lib/parseNaver";

interface SearchApiResponse {
  results: ViewResult[];
  found: ViewResult | null;
  foundRank: number | null;
  smartBlockResults: SmartBlockResult[];
  foundInSmartBlock: SmartBlockResult | null;
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
    // 수집 실패는 오류로 응답한다 (화면이 "미노출"로 저장하지 않도록)
    const serp = await fetchNaverSerp(keyword);
    if (!serp.ok) {
      return NextResponse.json({ error: serp.reason }, { status: serp.status });
    }
    const { results, smartBlockResults } = serp;

    let found: ViewResult | null = null;
    let foundInSmartBlock: SmartBlockResult | null = null;

    if (blogUrl) {
      found = results.find((r) => matchesBlogUrl(r.link, blogUrl)) ?? null;
      foundInSmartBlock =
        smartBlockResults.find((r) => matchesBlogUrl(r.link, blogUrl)) ?? null;
    }

    const responseData: SearchApiResponse = {
      results,
      found,
      foundRank: found ? found.rank : null,
      smartBlockResults,
      foundInSmartBlock,
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
