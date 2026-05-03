import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks, matchesBlogUrl } from "@/lib/parseNaver";
import { saveReporterHistory } from "@/lib/saveReporterHistory";

export const maxDuration = 300;

// 키워드당 10초 간격 (체인 패턴)
// NOTE: 기자단(reporter)은 cafe_clients 테이블을 공유함 (별도 reporter_clients 없음).
//        의도된 모델 — 카페 브랜드와 기자단 client는 동일 비즈니스 단위.
const KEYWORD_DELAY_MS = 10000;
const CHUNK_SIZE = 20;
const SYNC_THRESHOLD = 10;
const FETCH_TIMEOUT_MS = 8000;

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept-Language": "ko-KR,ko;q=0.9",
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

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
// offset/limit이 주어지면 해당 chunk만 처리 (chunk fan-out 모드)
async function processClient(
  client: { id: string; name: string },
  offset = 0,
  limit?: number
) {
  let updated = 0;
  const errors: string[] = [];

  let query = supabase
    .from("reporter_keywords")
    .select("id, keyword")
    .eq("client_id", client.id)
    .order("id", { ascending: true });

  if (limit !== undefined && limit > 0) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data: keywords, error: kwError } = await query;

  if (kwError || !keywords) return { updated, errors };

  // 키워드당 10초 간격
  for (let i = 0; i < keywords.length; i++) {
    const r = await processKeyword(client, keywords[i]);
    updated += r.updated;
    errors.push(...r.errors);
    if (i < keywords.length - 1) await sleep(KEYWORD_DELAY_MS);
  }

  return { updated, errors };
}

async function handler(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const offsetParam = sp.get("offset");
  const limitParam = sp.get("limit");

  try {
    // chunk 모드 (체인): clientId + offset + limit + total
    if (clientId && offsetParam !== null && limitParam !== null) {
      const offset = parseInt(offsetParam, 10);
      const limit = parseInt(limitParam, 10);
      const totalParam = sp.get("total");
      const totalForChain = totalParam !== null ? parseInt(totalParam, 10) : 0;

      // NN2: limit > CHUNK_SIZE 차단
      if (
        !Number.isFinite(offset) ||
        !Number.isFinite(limit) ||
        offset < 0 ||
        limit <= 0 ||
        limit > CHUNK_SIZE
      ) {
        return NextResponse.json(
          { error: `offset(>=0) / limit(>0, <=${CHUNK_SIZE}) 정수 필수` },
          { status: 400 }
        );
      }

      const { data: client } = await supabase
        .from("cafe_clients")
        .select("id, name")
        .eq("id", clientId)
        .single();
      if (!client) {
        return NextResponse.json({ error: "브랜드를 찾을 수 없습니다." }, { status: 404 });
      }
      const result = await processClient(client, offset, limit);

      // 체인: 다음 chunk trigger
      const nextOffset = offset + limit;
      const baseUrl = request.nextUrl.origin;
      if (totalForChain > 0 && nextOffset < totalForChain) {
        after(async () => {
          try {
            await fetch(
              `${baseUrl}/api/reporter/batch-track?clientId=${clientId}&offset=${nextOffset}&limit=${limit}&total=${totalForChain}`,
              { method: "POST" }
            );
          } catch (err) {
            console.error(`[reporter/batch-track] 체인 trigger 실패 nextOffset=${nextOffset}:`, err);
          }
        });
      }

      return NextResponse.json({
        message: `[${client.name}] chunk(offset=${offset}, limit=${limit}) ${result.updated}개 갱신, next=${nextOffset < totalForChain ? nextOffset : "done"}`,
        updated: result.updated,
        errors: result.errors,
        nextOffset: nextOffset < totalForChain ? nextOffset : null,
      });
    }

    // per-client 모드: 작은 client 동기, 큰 client는 chunk 체인 시작
    if (clientId) {
      const { data: client } = await supabase
        .from("cafe_clients")
        .select("id, name")
        .eq("id", clientId)
        .single();

      if (!client) {
        return NextResponse.json({ error: "브랜드를 찾을 수 없습니다." }, { status: 404 });
      }

      const { count } = await supabase
        .from("reporter_keywords")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId);
      const total = count ?? 0;

      if (total <= SYNC_THRESHOLD) {
        const result = await processClient(client);
        return NextResponse.json({
          message: `${result.updated}개 블로그기자단 순위 업데이트 완료`,
          updated: result.updated,
          errors: result.errors,
        });
      }

      const baseUrl = request.nextUrl.origin;
      const numChunks = Math.ceil(total / CHUNK_SIZE);

      after(async () => {
        try {
          await fetch(
            `${baseUrl}/api/reporter/batch-track?clientId=${clientId}&offset=0&limit=${CHUNK_SIZE}&total=${total}`,
            { method: "POST" }
          );
        } catch (err) {
          console.error(`[reporter/batch-track] 체인 시작 실패 client=${clientId}:`, err);
        }
      });

      return NextResponse.json({
        message: `[${client.name}] ${total}개 키워드 ${numChunks}개 chunk 체인 시작`,
        total,
        chunks: numChunks,
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
