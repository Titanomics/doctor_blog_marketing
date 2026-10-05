// 기자단 키워드 1건(등록된 글 여러 개) 수집·저장. Vercel 배치 라우트와 러너 스크립트가 함께 쓴다.
import { supabase } from "@/lib/supabase";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { matchesBlogUrl } from "@/lib/naverUrl";
import { saveReporterHistory } from "@/lib/saveReporterHistory";
import { nextPreviousRank } from "@/lib/rankUpdate";
import { recordFailure } from "@/lib/collectFailures";

export async function processReporterKeyword(
  client: { id: string; name: string },
  kw: { id: string; keyword: string }
): Promise<{ updated: number; errors: string[]; serpFailed?: boolean }> {
  const errors: string[] = [];
  let updated = 0;

  const { data: entries, error: entryError } = await supabase
    .from("reporter_blog_entries")
    .select("id, blog_url, current_rank, previous_rank, updated_at")
    .eq("keyword_id", kw.id);

  if (entryError || !entries || entries.length === 0) return { updated, errors };

  try {
    // 수집 실패 시에는 DB를 건드리지 않는다 (기존 순위 유지, "미노출"로 덮어쓰지 않음)
    const serp = await fetchNaverSerp(kw.keyword);
    if (!serp.ok) {
      await recordFailure("reporter", kw.id, "serp", serp.reason);
      errors.push(`[${client.name}] "${kw.keyword}" ${serp.reason} — 기존 순위 유지`);
      return { updated, errors, serpFailed: true };
    }
    const { results, smartBlockResults } = serp;

    for (const entry of entries) {
      const matched = results.find((r) => matchesBlogUrl(r.link, entry.blog_url));
      const matchedInSmartBlock = smartBlockResults.find((r) =>
        matchesBlogUrl(r.link, entry.blog_url)
      );

      const newRank = matched ? matched.rank : null;

      const { error: updateError } = await supabase
        .from("reporter_blog_entries")
        .update({
          previous_rank: nextPreviousRank(entry),
          current_rank: newRank,
          matched_title: matched?.title ?? matchedInSmartBlock?.title ?? null,
          matched_url: matched?.link ?? matchedInSmartBlock?.link ?? null,
          smart_block_name: matchedInSmartBlock?.blockName ?? null,
          smart_block_rank: matchedInSmartBlock?.rank ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry.id);

      if (updateError) {
        await recordFailure("reporter", kw.id, "db", updateError.message);
        errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}`);
      } else {
        const historyError = await saveReporterHistory(entry.id, newRank);
        if (historyError) {
          await recordFailure("reporter", kw.id, "history", historyError);
          errors.push(`[${client.name}] "${kw.keyword}" 이력 저장 실패: ${historyError}`);
        } else {
          updated++;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordFailure("reporter", kw.id, "other", msg);
    errors.push(`[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}`);
  }

  return { updated, errors };
}
