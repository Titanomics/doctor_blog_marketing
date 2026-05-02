import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks, matchesBlogUrl } from "@/lib/parseNaver";
import { saveKeywordHistory } from "@/lib/saveHistory";

export const maxDuration = 300;

const CONCURRENCY = 3;
const GROUP_DELAY_MS = 200;
const CHUNK_SIZE = 40;
// (legacy DELAY_MS는 sleep 호출에서 GROUP_DELAY_MS로 대체됨)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BlogKeywordRow = { id: string; keyword: string; current_rank: number | null };

async function processKeyword(
  client: { id: string; name: string; blog_url: string },
  kw: BlogKeywordRow
): Promise<{ ok: boolean; error?: string }> {
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
      return { ok: false, error: `[${client.name}] "${kw.keyword}" 네이버 검색 실패 (${response.status})` };
    }

    const html = await response.text();
    const results = parseViewSection(html);
    const smartBlockResults = parseSmartBlocks(html);

    const matched = results.find((r) => matchesBlogUrl(r.link, client.blog_url));
    const matchedInSmartBlock = smartBlockResults.find((r) => matchesBlogUrl(r.link, client.blog_url));

    const newRank = matched ? matched.rank : null;

    if (!matched && !matchedInSmartBlock) {
      if (results.length === 0 && smartBlockResults.length === 0) {
        console.warn(`[PARSE-MISS] "${kw.keyword}" | 파싱 결과 0개 (HTML길이=${html.length}) | blog_url="${client.blog_url}"`);
      } else {
        console.warn(`[MATCH-MISS] "${kw.keyword}" | VIEW=${results.length}개, 스마트블록=${smartBlockResults.length}개 | blog_url="${client.blog_url}" | 상위3링크: ${results.slice(0, 3).map((r) => r.link).join(" | ")}`);
      }
    }

    const { error: updateError } = await supabase
      .from("keywords")
      .update({
        previous_rank: kw.current_rank,
        current_rank: newRank,
        matched_title: matched?.title ?? matchedInSmartBlock?.title ?? null,
        matched_url: matched?.link ?? matchedInSmartBlock?.link ?? null,
        smart_block_name: matchedInSmartBlock?.blockName ?? null,
        smart_block_rank: matchedInSmartBlock?.rank ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", kw.id);

    if (updateError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}` };
    }

    await saveKeywordHistory(kw.id, newRank);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}` };
  }
}

// 단일 클라이언트 키워드 처리 — concurrency CONCURRENCY 그룹 병렬
// offset/limit이 주어지면 해당 chunk만 처리 (chunk fan-out 모드)
async function processClient(
  client: { id: string; name: string; blog_url: string },
  offset = 0,
  limit?: number
) {
  let updated = 0;
  const errors: string[] = [];

  let query = supabase
    .from("keywords")
    .select("id, keyword, current_rank")
    .eq("client_id", client.id)
    .order("id", { ascending: true });

  if (limit !== undefined && limit > 0) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data: keywords, error: kwError } = await query;

  if (kwError || !keywords) return { updated, errors };

  for (let i = 0; i < keywords.length; i += CONCURRENCY) {
    const chunk = keywords.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((kw) => processKeyword(client, kw)));
    for (const r of results) {
      if (r.ok) updated++;
      else if (r.error) errors.push(r.error);
    }
    if (i + CONCURRENCY < keywords.length) await sleep(GROUP_DELAY_MS);
  }

  return { updated, errors };
}

async function handler(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const offsetParam = sp.get("offset");
  const limitParam = sp.get("limit");

  try {
    // chunk 모드
    if (clientId && offsetParam !== null && limitParam !== null) {
      const offset = parseInt(offsetParam, 10);
      const limit = parseInt(limitParam, 10);
      const { data: client } = await supabase
        .from("clients")
        .select("id, name, blog_url")
        .eq("id", clientId)
        .single();
      if (!client) {
        return NextResponse.json({ error: "병원을 찾을 수 없습니다." }, { status: 404 });
      }
      const result = await processClient(client, offset, limit);
      return NextResponse.json({
        message: `[${client.name}] chunk(offset=${offset}, limit=${limit}) ${result.updated}개 갱신`,
        updated: result.updated,
        errors: result.errors,
      });
    }

    // per-client 모드 (수동 새로고침 / 팬아웃) — 큰 client는 chunk fan-out 자동 분할
    if (clientId) {
      const { data: client } = await supabase
        .from("clients")
        .select("id, name, blog_url")
        .eq("id", clientId)
        .single();

      if (!client) {
        return NextResponse.json({ error: "병원을 찾을 수 없습니다." }, { status: 404 });
      }

      const { count } = await supabase
        .from("keywords")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId);
      const total = count ?? 0;

      if (total <= CHUNK_SIZE) {
        const result = await processClient(client);
        return NextResponse.json({
          message: `${result.updated}개 키워드 순위 업데이트 완료`,
          updated: result.updated,
          errors: result.errors,
        });
      }

      const baseUrl = request.nextUrl.origin;
      const numChunks = Math.ceil(total / CHUNK_SIZE);

      after(async () => {
        for (let off = 0; off < total; off += CHUNK_SIZE) {
          try {
            await fetch(
              `${baseUrl}/api/batch-track?clientId=${clientId}&offset=${off}&limit=${CHUNK_SIZE}`,
              { method: "POST" }
            );
          } catch (err) {
            console.error(`[batch-track] chunk fan-out 실패 offset=${off}:`, err);
          }
        }
      });

      return NextResponse.json({
        message: `[${client.name}] ${total}개 키워드 ${numChunks}개 chunk 분할 처리 시작 (after fan-out)`,
        total,
        chunks: numChunks,
      });
    }

    // clientId 없으면 팬아웃: 클라이언트별 self-call (after()로 응답 후에도 실행 보장)
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, blog_url");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 병원이 없습니다.", updated: 0 });
    }

    const baseUrl = request.nextUrl.origin;

    after(async () => {
      for (const client of clients) {
        try {
          await fetch(`${baseUrl}/api/batch-track?clientId=${client.id}`, { method: "POST" });
        } catch (err) {
          console.error(`[batch-track] fan-out 실패 client=${client.name}:`, err);
        }
      }
    });

    return NextResponse.json({
      message: `${clients.length}개 병원 배치 시작 (after fan-out)`,
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
