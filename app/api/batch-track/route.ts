import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks, matchesBlogUrl } from "@/lib/parseNaver";
import { saveKeywordHistory } from "@/lib/saveHistory";

export const maxDuration = 300;

const DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 단일 클라이언트 키워드 처리
async function processClient(client: { id: string; name: string; blog_url: string }) {
  let updated = 0;
  const errors: string[] = [];

  const { data: keywords, error: kwError } = await supabase
    .from("keywords")
    .select("id, keyword, current_rank")
    .eq("client_id", client.id);

  if (kwError || !keywords) return { updated, errors };

  for (const kw of keywords) {
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
        cache: "no-store",
      });

      if (!response.ok) {
        errors.push(`[${client.name}] "${kw.keyword}" 네이버 검색 실패 (${response.status})`);
        continue;
      }

      const html = await response.text();
      const results = parseViewSection(html);
      const smartBlockResults = parseSmartBlocks(html);

      const matched = results.find((r) =>
        matchesBlogUrl(r.link, client.blog_url)
      );
      const matchedInSmartBlock = smartBlockResults.find((r) =>
        matchesBlogUrl(r.link, client.blog_url)
      );

      const newRank = matched ? matched.rank : null;

      // 진단 로그: 매칭 실패 시 원인 파악용
      if (!matched && !matchedInSmartBlock) {
        if (results.length === 0 && smartBlockResults.length === 0) {
          console.warn(`[PARSE-MISS] "${kw.keyword}" | 파싱 결과 0개 (HTML길이=${html.length}) | blog_url="${client.blog_url}"`);
        } else {
          console.warn(`[MATCH-MISS] "${kw.keyword}" | VIEW=${results.length}개, 스마트블록=${smartBlockResults.length}개 | blog_url="${client.blog_url}" | 상위3링크: ${results.slice(0, 3).map(r => r.link).join(" | ")}`);
        }
      }

      const { error: updateError } = await supabase
        .from("keywords")
        .update({
          previous_rank: kw.current_rank,
          current_rank: newRank,
          matched_title:
            matched?.title ?? matchedInSmartBlock?.title ?? null,
          matched_url: matched?.link ?? matchedInSmartBlock?.link ?? null,
          smart_block_name: matchedInSmartBlock?.blockName ?? null,
          smart_block_rank: matchedInSmartBlock?.rank ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", kw.id);

      if (updateError) {
        errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}`);
      } else {
        await saveKeywordHistory(kw.id, newRank);
        updated++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}`);
    }
  }

  return { updated, errors };
}

async function handler(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");

  try {
    // clientId가 있으면 해당 클라이언트만 처리 (수동 새로고침 / 팬아웃)
    if (clientId) {
      const { data: client } = await supabase
        .from("clients")
        .select("id, name, blog_url")
        .eq("id", clientId)
        .single();

      if (!client) {
        return NextResponse.json({ error: "병원을 찾을 수 없습니다." }, { status: 404 });
      }

      const result = await processClient(client);
      return NextResponse.json({
        message: `${result.updated}개 키워드 순위 업데이트 완료`,
        updated: result.updated,
        errors: result.errors,
      });
    }

    // clientId 없으면 팬아웃: 클라이언트별로 병렬 호출
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, blog_url");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 병원이 없습니다.", updated: 0 });
    }

    const baseUrl = request.nextUrl.origin;
    let totalUpdated = 0;
    const allErrors: string[] = [];

    const results = await Promise.allSettled(
      clients.map((client) =>
        fetch(`${baseUrl}/api/batch-track?clientId=${client.id}`, { method: "POST" })
          .then(async (res) => {
            if (res.ok) return res.json();
            throw new Error(`[${client.name}] 배치 호출 실패`);
          })
      )
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        totalUpdated += r.value.updated ?? 0;
        if (r.value.errors?.length) allErrors.push(...r.value.errors);
      } else {
        allErrors.push(r.reason?.message ?? `[${clients[i].name}] 배치 오류`);
      }
    }

    return NextResponse.json({
      message: `${totalUpdated}개 키워드 순위 업데이트 완료`,
      updated: totalUpdated,
      errors: allErrors,
    });
  } catch (error) {
    console.error("Batch track error:", error);
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
