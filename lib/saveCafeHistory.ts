import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

export async function saveCafeHistory(
  keywordId: string,
  rank: number | null
) {
  const today = getKSTDateString();

  await supabase.from("cafe_keyword_history").upsert(
    {
      keyword_id: keywordId,
      rank,
      tracked_date: today,
    },
    { onConflict: "keyword_id,tracked_date" }
  );
}
