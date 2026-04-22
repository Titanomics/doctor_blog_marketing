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

    // clientId 없으면 팬아웃: 클라이언트별로 fire-and-forget
    // Hobby 플랜 대응: 각 per-client 호출은 독립 함수로 실행되어 60초 제한 내 완료
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, blog_url");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 병원이 없습니다.", updated: 0 });
    }

    const baseUrl = request.nextUrl.origin;

    // fire-and-forget: await하지 않음, 각각 독립 서버리스 함수로 실행됨
    for (const client of clients) {
      fetch(`${baseUrl}/api/batch-track?clientId=${client.id}`, { method: "POST" }).catch(() => {});
    }

    // HTTP 요청이 전송될 시간 확보 (함수 종료 전에 요청이 나가야 함)
    await new Promise((r) => setTimeout(r, 2000));

    return NextResponse.json({
      message: `${clients.length}개 병원 배치 시작`,
      clients: clients.length,
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
