import { NextRequest, NextResponse } from "next/server";
import { parseReplies } from "@/lib/parseNaver";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { cafeRefToUrl, parseCafeRef, resolveCafeTarget, sameCafeArticle } from "@/lib/naverUrl";
import type { ViewResult, SmartBlockResult, ReplyResult } from "@/lib/parseNaver";
import { getCafePostStatus, type CafePostStatus } from "@/lib/checkCafePostDeleted";

interface CafeSearchApiResponse {
  results: ViewResult[];
  found: ViewResult | null;
  foundRank: number | null;
  smartBlockResults: SmartBlockResult[];
  foundInSmartBlock: SmartBlockResult | null;
  replyResults: ReplyResult[];
  foundInReply: ReplyResult | null;
  postDeleted: boolean; // 하위 호환: 'deleted' 상태일 때만 true
  postStatus: CafePostStatus | null; // null = 검사 미수행
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
    // 수집 실패는 오류로 응답한다 (화면이 "미노출"로 저장하지 않도록)
    const serp = await fetchNaverSerp(keyword);
    if (!serp.ok) {
      return NextResponse.json({ error: serp.reason }, { status: serp.status });
    }
    const { results, smartBlockResults } = serp;
    const replyResults = parseReplies(serp.html);

    let found: ViewResult | null = null;
    let foundInSmartBlock: SmartBlockResult | null = null;
    let foundInReply: ReplyResult | null = null;

    // 등록 URL이 글 URL(직접 또는 naver.me)이면 카페·글 번호 완전일치로만 매칭한다.
    // 글 URL이 아닐 때만 제목 포함 여부로 매칭.
    const targetRef = await resolveCafeTarget(postUrl);
    if (targetRef === "unresolved") {
      return NextResponse.json(
        { error: "단축 URL을 해석하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 502 }
      );
    }
    const hasSpecificPostId = !!targetRef;

    if (targetRef || postTitle) {
      const title = postTitle?.toLowerCase() || null;
      const matchLink = (link: string, text: string | undefined) => {
        const ref = parseCafeRef(link); // 카페 글 링크가 아니면 null (블로그/외부 사이트 제외)
        if (!ref) return false;
        if (targetRef) return sameCafeArticle(ref, targetRef);
        return !!(title && text && text.toLowerCase().includes(title));
      };

      found = results.find((r) => matchLink(r.link, r.title)) ?? null;
      foundInSmartBlock = smartBlockResults.find((r) => matchLink(r.link, r.title)) ?? null;

      // VIEW/스마트블록에서 못 찾은 경우에만 꼬리글(.series) 매칭
      if (!found && !foundInSmartBlock) {
        foundInReply = replyResults.find((r) => matchLink(r.link, r.text)) ?? null;
      }
    }

    // 특정 게시글 URL이 있고, 어디에서도 못 찾은 경우 → 게시글 상태 확인
    let postStatus: CafePostStatus | null = null;
    const canonicalUrl = targetRef ? cafeRefToUrl(targetRef) : null;
    if (hasSpecificPostId && canonicalUrl && !found && !foundInSmartBlock && !foundInReply) {
      postStatus = await getCafePostStatus(canonicalUrl);
    }
    const postDeleted = postStatus === "deleted";

    const responseData: CafeSearchApiResponse = {
      results,
      found,
      foundRank: found ? found.rank : null,
      smartBlockResults,
      foundInSmartBlock,
      replyResults,
      foundInReply,
      postDeleted,
      postStatus,
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
