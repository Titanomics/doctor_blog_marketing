import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

// 저장 실패 시 오류 메시지를 돌려준다 (성공하면 null).
export async function saveCafeHistory(
  keywordId: string,
  rank: number | null
): Promise<string | null> {
  const today = getKSTDateString();

  const { error } = await supabase.from("cafe_keyword_history").upsert(
    {
      keyword_id: keywordId,
      rank,
      tracked_date: today,
    },
    { onConflict: "keyword_id,tracked_date" }
  );

  if (error) {
    console.error(`[cafe_keyword_history] 이력 저장 실패: ${error.message}`);
    return error.message;
  }
  return null;
}
