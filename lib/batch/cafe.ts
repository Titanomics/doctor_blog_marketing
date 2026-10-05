// 카페 키워드 1건 수집·저장. Vercel 배치 라우트와 러너 스크립트가 함께 쓴다.
import { supabase } from "@/lib/supabase";
import { parseReplies } from "@/lib/parseNaver";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { cafeRefToUrl, parseCafeRef, resolveCafeTarget, sameCafeArticle } from "@/lib/naverUrl";
import { saveCafeHistory } from "@/lib/saveCafeHistory";
import { nextPreviousRank } from "@/lib/rankUpdate";
import { getCafePostStatus, type CafePostStatus } from "@/lib/checkCafePostDeleted";
import { getTodayPostStatus, isWeeklyRecheckDay, postKey } from "@/lib/cafePostStats";

// 처리에 필요한 컬럼 (라우트와 러너가 같은 목록을 쓴다)
export const CAFE_KEYWORD_COLUMNS =
  "id, keyword, current_rank, previous_rank, updated_at, post_url, post_title, is_reply, reply_since, matched_title";

export type CafeKeywordRow = {
  id: string;
  keyword: string;
  current_rank: number | null;
  previous_rank: number | null;
  updated_at: string | null;
  post_url: string | null;
  post_title: string | null;
  is_reply: boolean;
  reply_since: string | null;
  matched_title: string | null;
};

// 단일 키워드 처리 (병렬 호출 가능 단위)
export async function processCafeKeyword(
  client: { id: string; name: string },
  kw: CafeKeywordRow
): Promise<{ ok: boolean; error?: string; serpFailed?: boolean }> {
  try {
    // 수집 실패 시에는 DB를 건드리지 않는다 (기존 순위 유지, "미노출"로 덮어쓰지 않음)
    const serp = await fetchNaverSerp(kw.keyword);
    if (!serp.ok) {
      return { ok: false, serpFailed: true, error: `[${client.name}] "${kw.keyword}" ${serp.reason} — 기존 순위 유지` };
    }
    const { results, smartBlockResults } = serp;
    const replyResults = parseReplies(serp.html);

    // 등록 URL이 글 URL(직접 또는 naver.me)이면 카페·글 번호 완전일치로만 매칭한다.
    // 글 URL이 아닐 때만 제목 포함 여부로 매칭.
    const targetRef = await resolveCafeTarget(kw.post_url);
    if (targetRef === "unresolved") {
      // 단축 URL을 일시적으로 해석하지 못함 — 어느 글인지 모르는 채로 "미노출"을 저장하지 않는다
      return { ok: false, error: `[${client.name}] "${kw.keyword}" 단축 URL 해석 실패 — 기존 순위 유지` };
    }
    const hasSpecificPostId = !!targetRef;
    const postTitle = kw.post_title?.toLowerCase() || null;

    const matchLink = (link: string, text: string | undefined) => {
      const ref = parseCafeRef(link); // 카페 글 링크가 아니면 null (블로그/외부 사이트 제외)
      if (!ref) return false;
      if (targetRef) return sameCafeArticle(ref, targetRef);
      return !!(postTitle && text && text.toLowerCase().includes(postTitle));
    };

    const found = results.find((r) => matchLink(r.link, r.title)) ?? null;
    const foundInSmartBlock = smartBlockResults.find((r) => matchLink(r.link, r.title)) ?? null;

    let foundInReply = null;
    if (!found && !foundInSmartBlock) {
      foundInReply = replyResults.find((r) => matchLink(r.link, r.text)) ?? null;
    }

    const newRank = found ? found.rank : null;
    const isReply = !!foundInReply && !found && !foundInSmartBlock;

    let replySince = kw.reply_since;
    if (isReply && !kw.is_reply) {
      replySince = new Date().toISOString();
    } else if (!isReply) {
      replySince = null;
    }

    const wasMarkedDeleted = kw.matched_title === "[삭제된 게시글]";
    const noMatchFound = !found && !foundInSmartBlock && !foundInReply;

    // 검색에 없는 글만 생존 여부를 확인한다.
    // 글 API는 글당 하루 1회가 원칙 — /api/cafe/post-stats 가 오늘 이미 관측했으면 그 결과를 쓴다.
    // 오늘 관측이 없을 때만 직접 조회하고, 이미 삭제로 확인된 글은 주 1회 요일에만 다시 묻는다.
    let postStatus: CafePostStatus | null = null;
    const canonicalUrl = targetRef ? cafeRefToUrl(targetRef) : null;
    if (hasSpecificPostId && noMatchFound && targetRef?.cafe && canonicalUrl) {
      postStatus = await getTodayPostStatus(targetRef.cafe, targetRef.articleId);
      if (
        !postStatus &&
        (!wasMarkedDeleted || isWeeklyRecheckDay(postKey(targetRef.cafe, targetRef.articleId)))
      ) {
        postStatus = await getCafePostStatus(canonicalUrl);
      }
    }
    const keepDeletedMark =
      postStatus === "deleted" ||
      (postStatus !== "alive" && noMatchFound && wasMarkedDeleted);

    const { error: updateError } = await supabase
      .from("cafe_keywords")
      .update({
        previous_rank: nextPreviousRank(kw),
        current_rank: newRank,
        matched_title: keepDeletedMark
          ? "[삭제된 게시글]"
          : (found?.title ?? foundInSmartBlock?.title ?? null),
        matched_url:
          found?.link ?? foundInSmartBlock?.link ?? null,
        smart_block_name: foundInSmartBlock?.blockName ?? null,
        smart_block_rank: foundInSmartBlock?.rank ?? null,
        is_reply: isReply,
        reply_since: replySince,
        updated_at: new Date().toISOString(),
      })
      .eq("id", kw.id);

    if (updateError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}` };
    }

    const historyError = await saveCafeHistory(kw.id, newRank);
    if (historyError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" 이력 저장 실패: ${historyError}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}` };
  }
}
