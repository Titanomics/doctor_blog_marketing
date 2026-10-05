import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

// 저장 실패 시 오류 메시지를 돌려준다 (성공하면 null).
export async function saveReporterHistory(
  entryId: string,
  rank: number | null
): Promise<string | null> {
  const today = getKSTDateString();

  const { error } = await supabase.from("reporter_blog_history").upsert(
    {
      entry_id: entryId,
      rank,
      tracked_date: today,
    },
    { onConflict: "entry_id,tracked_date" }
  );

  if (error) {
    console.error(`[reporter_blog_history] 이력 저장 실패: ${error.message}`);
    return error.message;
  }
  return null;
}
