import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

export async function saveReporterHistory(
  entryId: string,
  rank: number | null
) {
  const today = getKSTDateString();

  await supabase.from("reporter_blog_history").upsert(
    {
      entry_id: entryId,
      rank,
      tracked_date: today,
    },
    { onConflict: "entry_id,tracked_date" }
  );
}
