import { supabase } from "@/lib/supabase";

export async function saveKeywordHistory(
  keywordId: string,
  rank: number | null
) {
  const today = new Date().toISOString().split("T")[0];

  // upsert: 같은 날짜에 이미 기록이 있으면 업데이트
  await supabase.from("keyword_history").upsert(
    {
      keyword_id: keywordId,
      rank,
      tracked_date: today,
    },
    { onConflict: "keyword_id,tracked_date" }
  );
}
