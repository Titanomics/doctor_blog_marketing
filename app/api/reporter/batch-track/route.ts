import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks } from "@/lib/parseNaver";
import { saveReporterHistory } from "@/lib/saveReporterHistory";

const DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handler() {
  try {
    const { data: clients, error: clientsError } = await supabase
      .from("cafe_clients")
      .select("id, name");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 브랜드가 없습니다.", updated: 0 });
    }

    let totalUpdated = 0;
    const errors: string[] = [];

    for (const client of clients) {
      const { data: keywords, error: kwError } = await supabase
        .from("reporter_keywords")
        .select("id, keyword")
        .eq("client_id", client.id);

      if (kwError || !keywords) continue;

      for (const kw of keywords) {
        const { data: entries, error: entryError } = await supabase
          .from("reporter_blog_entries")
          .select("id, blog_url, current_rank")
          .eq("keyword_id", kw.id);

        if (entryError || !entries) continue;

        for (const entry of entries) {
          try {
            await sleep(DELAY_MS);

            const encodedKeyword = encodeURIComponent(kw.keyword);
            const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodedKeyword}`;

            const response = await fetch(url, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept-Language": "ko-KR,ko;q=0.9",
              },
            });

            if (!response.ok) {
              errors.push(`[${client.name}] "${kw.keyword}" ${entry.blog_url} 검색 실패`);
              continue;
            }

            const html = await response.text();
            const results = parseViewSection(html);
            const smartBlockResults = parseSmartBlocks(html);

            const normalizedUrl = entry.blog_url.trim();
            const matched = results.find((r) => r.link.includes(normalizedUrl));
            const matchedInSmartBlock = smartBlockResults.find((r) =>
              r.link.includes(normalizedUrl)
            );

            const newRank = matched ? matched.rank : null;

            const { error: updateError } = await supabase
              .from("reporter_blog_entries")
              .update({
                previous_rank: entry.current_rank,
                current_rank: newRank,
                matched_title: matched?.title ?? matchedInSmartBlock?.title ?? null,
                matched_url: matched?.link ?? matchedInSmartBlock?.link ?? null,
                smart_block_name: matchedInSmartBlock?.blockName ?? null,
                smart_block_rank: matchedInSmartBlock?.rank ?? null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", entry.id);

            if (updateError) {
              errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패`);
            } else {
              await saveReporterHistory(entry.id, newRank);
              totalUpdated++;
            }
          } catch {
            errors.push(`[${client.name}] "${kw.keyword}" ${entry.blog_url} 처리 중 오류`);
          }
        }
      }
    }

    return NextResponse.json({
      message: `${totalUpdated}개 블로그기자단 순위 업데이트 완료`,
      updated: totalUpdated,
      errors,
    });
  } catch (error) {
    console.error("Reporter batch track error:", error);
    return NextResponse.json(
      { error: "배치 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function GET(_request: NextRequest) {
  return handler();
}

export async function POST(_request: NextRequest) {
  return handler();
}
