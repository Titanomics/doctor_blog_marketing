import { supabase } from "@/lib/supabase";

export async function saveReporterHistory(
  entryId: string,
  rank: number | null
) {
  const today = new Date().toISOString().split("T")[0];

  await supabase.from("reporter_blog_history").upsert(
    {
      entry_id: entryId,
      rank,
      tracked_date: today,
    },
    { onConflict: "entry_id,tracked_date" }
  );
}
