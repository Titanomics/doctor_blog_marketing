import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveCafeHistory } from "@/lib/saveCafeHistory";

const DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const { data: clients, error: clientsError } = await supabase
      .from("cafe_clients")
      .select("id, name");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({
        message: "등록된 브랜드가 없습니다.",
        updated: 0,
      });
    }

    const baseUrl = request.nextUrl.origin;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const client of clients) {
      const { data: keywords, error: kwError } = await supabase
        .from("cafe_keywords")
        .select("id, keyword, current_rank, post_url, post_title")
        .eq("client_id", client.id);

      if (kwError || !keywords) continue;

      for (const kw of keywords) {
        try {
          await sleep(DELAY_MS);

          const params = new URLSearchParams({ keyword: kw.keyword });
          if (kw.post_url) params.set("postUrl", kw.post_url);
          if (kw.post_title) params.set("postTitle", kw.post_title);
          const searchRes = await fetch(`${baseUrl}/api/cafe/search?${params.toString()}`);

          if (!searchRes.ok) {
            errors.push(`[${client.name}] "${kw.keyword}" 검색 실패`);
            continue;
          }

          const data = await searchRes.json();

          const newRank = data.foundRank ?? null;

          const { error: updateError } = await supabase
            .from("cafe_keywords")
            .update({
              previous_rank: kw.current_rank,
              current_rank: newRank,
              matched_title:
                data.found?.title ?? data.foundInSmartBlock?.title ?? null,
              matched_url:
                data.found?.link ?? data.foundInSmartBlock?.link ?? null,
              smart_block_name: data.foundInSmartBlock?.blockName ?? null,
              smart_block_rank: data.foundInSmartBlock?.rank ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", kw.id);

          if (updateError) {
            errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패`);
          } else {
            await saveCafeHistory(kw.id, newRank);
            totalUpdated++;
          }
        } catch {
          errors.push(`[${client.name}] "${kw.keyword}" 처리 중 오류`);
        }
      }
    }

    return NextResponse.json({
      message: `${totalUpdated}개 키워드 순위 업데이트 완료`,
      updated: totalUpdated,
      errors,
    });
  } catch (error) {
    console.error("Cafe batch track error:", error);
    return NextResponse.json(
      { error: "배치 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
