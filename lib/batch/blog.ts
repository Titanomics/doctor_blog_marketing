// 블로그 키워드 1건 수집·저장. Vercel 배치 라우트와 러너 스크립트가 함께 쓴다.
import { supabase } from "@/lib/supabase";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { matchesBlogUrl } from "@/lib/naverUrl";
import { saveKeywordHistory } from "@/lib/saveHistory";
import { nextPreviousRank } from "@/lib/rankUpdate";

// 처리에 필요한 컬럼 (라우트와 러너가 같은 목록을 쓴다)
export const BLOG_KEYWORD_COLUMNS = "id, keyword, current_rank, previous_rank, updated_at";

export type BlogKeywordRow = {
  id: string;
  keyword: string;
  current_rank: number | null;
  previous_rank: number | null;
  updated_at: string | null;
};

export async function processBlogKeyword(
  client: { id: string; name: string; blog_url: string },
  kw: BlogKeywordRow
): Promise<{ ok: boolean; error?: string; serpFailed?: boolean }> {
  try {
    // 수집 실패 시에는 DB를 건드리지 않는다 (기존 순위 유지, "미노출"로 덮어쓰지 않음)
    const serp = await fetchNaverSerp(kw.keyword);
    if (!serp.ok) {
      return { ok: false, serpFailed: true, error: `[${client.name}] "${kw.keyword}" ${serp.reason} — 기존 순위 유지` };
    }
    const { results, smartBlockResults } = serp;

    const matched = results.find((r) => matchesBlogUrl(r.link, client.blog_url));
    const matchedInSmartBlock = smartBlockResults.find((r) => matchesBlogUrl(r.link, client.blog_url));

    const newRank = matched ? matched.rank : null;

    if (!matched && !matchedInSmartBlock) {
      console.warn(`[MATCH-MISS] "${kw.keyword}" | VIEW=${results.length}개, 스마트블록=${smartBlockResults.length}개 | blog_url="${client.blog_url}" | 상위3링크: ${results.slice(0, 3).map((r) => r.link).join(" | ")}`);
    }

    const { error: updateError } = await supabase
      .from("keywords")
      .update({
        previous_rank: nextPreviousRank(kw),
        current_rank: newRank,
        matched_title: matched?.title ?? matchedInSmartBlock?.title ?? null,
        matched_url: matched?.link ?? matchedInSmartBlock?.link ?? null,
        smart_block_name: matchedInSmartBlock?.blockName ?? null,
        smart_block_rank: matchedInSmartBlock?.rank ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", kw.id);

    if (updateError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}` };
    }

    const historyError = await saveKeywordHistory(kw.id, newRank);
    if (historyError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" 이력 저장 실패: ${historyError}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}` };
  }
}
