import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { internalAuthHeaders } from "@/lib/auth";
import { CAFE_KEYWORD_COLUMNS, processCafeKeyword } from "@/lib/batch/cafe";

export const maxDuration = 300;

// 키워드당 10초 간격 — 네이버 입장 0.1 req/s = 사람 검색과 동일
const KEYWORD_DELAY_MS = 10000;
// chunk 자식 maxDuration(300s) 보호: 20 키워드 × 10초 = 200s
const CHUNK_SIZE = 20;
// 동기 처리 임계 (이 이하면 chunk 분할 없이 직접 처리, 부모 maxDuration 보호)
const SYNC_THRESHOLD = 10;
// 단일 키워드 fetch timeout (네이버 응답 지연 누적 방지)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 단일 클라이언트 키워드 처리 — concurrency CONCURRENCY로 그룹 병렬 + 그룹 간 인터벌
// offset/limit이 주어지면 해당 chunk만 처리 (chunk fan-out 모드)
async function processClient(
  client: { id: string; name: string },
  offset = 0,
  limit?: number
) {
  let updated = 0;
  const errors: string[] = [];

  let query = supabase
    .from("cafe_keywords")
    .select(CAFE_KEYWORD_COLUMNS)
    .eq("client_id", client.id)
    .order("id", { ascending: true });

  if (limit !== undefined && limit > 0) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data: keywords, error: kwError } = await query;

  if (kwError || !keywords) return { updated, errors };

  // 키워드당 10초 간격 — 네이버 차단 회피
  for (let i = 0; i < keywords.length; i++) {
    const r = await processCafeKeyword(client, keywords[i]);
    if (r.ok) updated++;
    else if (r.error) errors.push(r.error);
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
    // chunk 모드: clientId + offset + limit + total → 해당 범위 처리 후 다음 chunk 체인 trigger
    if (clientId && offsetParam !== null && limitParam !== null) {
      const offset = parseInt(offsetParam, 10);
      const limit = parseInt(limitParam, 10);
      const totalParam = sp.get("total");
      const totalForChain = totalParam !== null ? parseInt(totalParam, 10) : 0;

      // NN2: limit가 CHUNK_SIZE 초과는 차단 (외부 임의 호출 시 자식 timeout 방지)
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

      // 체인: 다음 chunk가 남아 있으면 trigger (자식 maxDuration 분산)
      const nextOffset = offset + limit;
      const baseUrl = request.nextUrl.origin;
      if (totalForChain > 0 && nextOffset < totalForChain) {
        after(async () => {
          try {
            await fetch(
              `${baseUrl}/api/cafe/batch-track?clientId=${clientId}&offset=${nextOffset}&limit=${limit}&total=${totalForChain}`,
              { method: "POST", headers: internalAuthHeaders() }
            );
          } catch (err) {
            console.error(
              `[cafe/batch-track] 체인 trigger 실패 nextOffset=${nextOffset}:`,
              err
            );
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

    // per-client 모드: 작은 client는 동기, 큰 client는 chunk 체인 시작
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
        .from("cafe_keywords")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId);
      const total = count ?? 0;

      // NN4: 동기 처리 임계는 SYNC_THRESHOLD (부모 maxDuration 안 안전 보장)
      if (total <= SYNC_THRESHOLD) {
        const result = await processClient(client);
        return NextResponse.json({
          message: `${result.updated}개 키워드 순위 업데이트 완료`,
          updated: result.updated,
          errors: result.errors,
        });
      }

      // 큰 client: chunk 체인 시작 (첫 chunk만 trigger, 이후 자식이 다음 chunk를 trigger)
      const baseUrl = request.nextUrl.origin;
      const numChunks = Math.ceil(total / CHUNK_SIZE);

      after(async () => {
        try {
          await fetch(
            `${baseUrl}/api/cafe/batch-track?clientId=${clientId}&offset=0&limit=${CHUNK_SIZE}&total=${total}`,
            { method: "POST", headers: internalAuthHeaders() }
          );
        } catch (err) {
          console.error(`[cafe/batch-track] 체인 시작 실패 client=${clientId}:`, err);
        }
      });

      return NextResponse.json({
        message: `[${client.name}] ${total}개 키워드 ${numChunks}개 chunk 체인 시작`,
        total,
        chunks: numChunks,
      });
    }

    // clientId 없으면 팬아웃: 클라이언트별 self-call (after()로 응답 후에도 실행 보장)
    const baseUrl = request.nextUrl.origin;
    const { data: clients, error: clientsError } = await supabase
      .from("cafe_clients")
      .select("id, name");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 브랜드가 없습니다.", updated: 0 });
    }

    // after(): 응답 후 비동기 작업 실행 보장 (Vercel 서버리스에서 fire-and-forget의 outgoing fetch 끊김 방지)
    after(async () => {
      for (const client of clients) {
        try {
          await fetch(`${baseUrl}/api/cafe/batch-track?clientId=${client.id}`, { method: "POST", headers: internalAuthHeaders() });
        } catch (err) {
          console.error(`[cafe/batch-track] fan-out 실패 client=${client.name}:`, err);
        }
      }
    });

    return NextResponse.json({
      message: `${clients.length}개 브랜드 배치 시작 (after fan-out)`,
      clients: clients.length,
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
