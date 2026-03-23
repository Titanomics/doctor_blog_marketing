import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveCafeHistory } from "@/lib/saveCafeHistory";

export const maxDuration = 300;

const DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 단일 클라이언트 키워드 처리
async function processClient(
  client: { id: string; name: string },
  baseUrl: string
) {
  let updated = 0;
  const errors: string[] = [];

  const { data: keywords, error: kwError } = await supabase
    .from("cafe_keywords")
    .select("id, keyword, current_rank, post_url, post_title, is_reply, reply_since")
    .eq("client_id", client.id);

  if (kwError || !keywords) return { updated, errors };

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
      const isReply = !!data.foundInReply && !data.found && !data.foundInSmartBlock;

      // 꼬리글 상태 전환 로직
      let replySince = kw.reply_since;
      if (isReply && !kw.is_reply) {
        replySince = new Date().toISOString();
      } else if (!isReply) {
        if (!kw.is_reply) {
          replySince = null;
        }
      }

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
          is_reply: isReply,
          reply_since: replySince,
          updated_at: new Date().toISOString(),
        })
        .eq("id", kw.id);

      if (updateError) {
        errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패`);
      } else {
        await saveCafeHistory(kw.id, newRank);
        updated++;
      }
    } catch {
      errors.push(`[${client.name}] "${kw.keyword}" 처리 중 오류`);
    }
  }

  return { updated, errors };
}

async function handler(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  const baseUrl = request.nextUrl.origin;

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

      const result = await processClient(client, baseUrl);
      return NextResponse.json({
        message: `${result.updated}개 키워드 순위 업데이트 완료`,
        updated: result.updated,
        errors: result.errors,
      });
    }

    // clientId 없으면 팬아웃: 클라이언트별로 개별 호출
    const { data: clients, error: clientsError } = await supabase
      .from("cafe_clients")
      .select("id, name");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 브랜드가 없습니다.", updated: 0 });
    }

    let totalUpdated = 0;
    const allErrors: string[] = [];

    for (const client of clients) {
      try {
        const res = await fetch(
          `${baseUrl}/api/cafe/batch-track?clientId=${client.id}`,
          { method: "POST" }
        );
        if (res.ok) {
          const data = await res.json();
          totalUpdated += data.updated ?? 0;
          if (data.errors?.length) allErrors.push(...data.errors);
        } else {
          allErrors.push(`[${client.name}] 배치 호출 실패`);
        }
      } catch {
        allErrors.push(`[${client.name}] 배치 호출 오류`);
      }
    }

    return NextResponse.json({
      message: `${totalUpdated}개 키워드 순위 업데이트 완료`,
      updated: totalUpdated,
      errors: allErrors,
    });
  } catch (error) {
    console.error("Cafe batch track error:", error);
    return NextResponse.json(
      { error: "배치 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handler(request);
}

export async function GET(request: NextRequest) {
  return handler(request);
}
