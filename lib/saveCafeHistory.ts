import { supabase } from "@/lib/supabase";

export async function saveCafeHistory(
  keywordId: string,
  rank: number | null
) {
  const today = new Date().toISOString().split("T")[0];

  await supabase.from("cafe_keyword_history").upsert(
    {
      keyword_id: keywordId,
      rank,
      tracked_date: today,
    },
    { onConflict: "keyword_id,tracked_date" }
  );
}
