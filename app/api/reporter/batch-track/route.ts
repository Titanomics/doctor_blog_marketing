import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks, matchesBlogUrl } from "@/lib/parseNaver";
import { saveReporterHistory } from "@/lib/saveReporterHistory";

export const maxDuration = 300;

const CONCURRENCY = 3;
const GROUP_DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processKeyword(
  client: { id: string; name: string },
  kw: { id: string; keyword: string }
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  const { data: entries, error: entryError } = await supabase
    .from("reporter_blog_entries")
    .select("id, blog_url, current_rank")
    .eq("keyword_id", kw.id);

  if (entryError || !entries || entries.length === 0) return { updated, errors };

  try {
    const encodedKeyword = encodeURIComponent(kw.keyword);
    const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodedKeyword}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      errors.push(`[${client.name}] "${kw.keyword}" 네이버 검색 실패 (${response.status})`);
      return { updated, errors };
    }

    const html = await response.text();
    const results = parseViewSection(html);
    const smartBlockResults = parseSmartBlocks(html);

    for (const entry of entries) {
      const matched = results.find((r) => matchesBlogUrl(r.link, entry.blog_url));
      const matchedInSmartBlock = smartBlockResults.find((r) =>
        matchesBlogUrl(r.link, entry.blog_url)
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
        errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}`);
      } else {
        await saveReporterHistory(entry.id, newRank);
        updated++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}`);
  }

  return { updated, errors };
}

// 단일 클라이언트 처리 — concurrency CONCURRENCY 그룹 병렬
async function processClient(client: { id: string; name: string }) {
  let updated = 0;
  const errors: string[] = [];

  const { data: keywords, error: kwError } = await supabase
    .from("reporter_keywords")
    .select("id, keyword")
    .eq("client_id", client.id);

  if (kwError || !keywords) return { updated, errors };

  for (let i = 0; i < keywords.length; i += CONCURRENCY) {
    const chunk = keywords.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((kw) => processKeyword(client, kw)));
    for (const r of results) {
      updated += r.updated;
      errors.push(...r.errors);
    }
    if (i + CONCURRENCY < keywords.length) await sleep(GROUP_DELAY_MS);
  }

  return { updated, errors };
}

async function handler(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");

  try {
    // clientId가 있으면 해당 클라이언트만 처리
    if (clientId) {
      const { data: client } = await supabase
        .from("cafe_clients")
        .select("id, name")
        .eq("id", clientId)
        .single();

      if (!client) {
        return NextResponse.json({ error: "브랜드를 찾을 수 없습니다." }, { status: 404 });
      }

      const result = await processClient(client);
      return NextResponse.json({
        message: `${result.updated}개 블로그기자단 순위 업데이트 완료`,
        updated: result.updated,
        errors: result.errors,
      });
    }

    // clientId 없으면 팬아웃: 클라이언트별 self-call (after()로 응답 후에도 실행 보장)
    const { data: clients, error: clientsError } = await supabase
      .from("cafe_clients")
      .select("id, name");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 브랜드가 없습니다.", updated: 0 });
    }

    const baseUrl = request.nextUrl.origin;

    after(async () => {
      for (const client of clients) {
        try {
          await fetch(`${baseUrl}/api/reporter/batch-track?clientId=${client.id}`, { method: "POST" });
        } catch (err) {
          console.error(`[reporter/batch-track] fan-out 실패 client=${client.name}:`, err);
        }
      }
    });

    return NextResponse.json({
      message: `${clients.length}개 브랜드 기자단 배치 시작 (after fan-out)`,
      clients: clients.length,
    });
  } catch (error) {
    console.error("Reporter batch track error:", error);
    return NextResponse.json(
      { error: "배치 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
