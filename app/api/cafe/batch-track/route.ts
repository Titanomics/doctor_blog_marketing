import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks, parseReplies } from "@/lib/parseNaver";
import { saveCafeHistory } from "@/lib/saveCafeHistory";
import { getCafePostStatus, type CafePostStatus } from "@/lib/checkCafePostDeleted";

export const maxDuration = 300;

// per-client 키워드 처리 동시성 (네이버 차단 회피용으로 보수적)
const CONCURRENCY = 3;
// 동시 그룹 간 인터벌 (단일 키워드는 stagger됨)
const GROUP_DELAY_MS = 200;
// chunk 임계: 키워드 수가 이보다 크면 chunk fan-out으로 분할 (maxDuration 안전 마진)
const CHUNK_SIZE = 40;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CafeKeywordRow = {
  id: string;
  keyword: string;
  current_rank: number | null;
  post_url: string | null;
  post_title: string | null;
  is_reply: boolean;
  reply_since: string | null;
  matched_title: string | null;
};

// 단일 키워드 처리 (병렬 호출 가능 단위)
async function processKeyword(
  client: { id: string; name: string },
  kw: CafeKeywordRow
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
    const replyResults = parseReplies(html);

    const normalize = (link: string) =>
      link.replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com");
    const normalizedPostUrl = kw.post_url
      ? kw.post_url.trim().replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com")
      : null;

    const hasSpecificPostId = normalizedPostUrl && /\/\d+/.test(normalizedPostUrl);

    const match = (r: { link: string; title?: string }) => {
      const urlMatch = normalizedPostUrl && normalize(r.link).includes(normalizedPostUrl);
      if (hasSpecificPostId) return !!urlMatch;
      if (urlMatch) return true;
      if (kw.post_title && "title" in r && r.title && r.title.toLowerCase().includes(kw.post_title.toLowerCase())) return true;
      return false;
    };

    const found = results.find(match) ?? null;
    const foundInSmartBlock = smartBlockResults.find(match) ?? null;

    let foundInReply = null;
    if (!found && !foundInSmartBlock) {
      const matchReply = (r: { link: string; text: string }) => {
        const urlMatch = normalizedPostUrl && normalize(r.link).includes(normalizedPostUrl);
        if (hasSpecificPostId) return !!urlMatch;
        if (urlMatch) return true;
        if (kw.post_title && r.text.toLowerCase().includes(kw.post_title.toLowerCase())) return true;
        return false;
      };
      foundInReply = replyResults.find(matchReply) ?? null;
    }

    const newRank = found ? found.rank : null;
    const isReply = !!foundInReply && !found && !foundInSmartBlock;

    let replySince = kw.reply_since;
    if (isReply && !kw.is_reply) {
      replySince = new Date().toISOString();
    } else if (!isReply) {
      replySince = null;
    }

    let postStatus: CafePostStatus | null = null;
    if (hasSpecificPostId && !found && !foundInSmartBlock && !foundInReply && normalizedPostUrl) {
      postStatus = await getCafePostStatus(normalizedPostUrl);
    }

    const wasMarkedDeleted = kw.matched_title === "[삭제된 게시글]";
    const noMatchFound = !found && !foundInSmartBlock && !foundInReply;
    const keepDeletedMark =
      postStatus === "deleted" ||
      (postStatus !== "alive" && noMatchFound && wasMarkedDeleted);

    const { error: updateError } = await supabase
      .from("cafe_keywords")
      .update({
        previous_rank: kw.current_rank,
        current_rank: newRank,
        matched_title: keepDeletedMark
          ? "[삭제된 게시글]"
          : (found?.title ?? foundInSmartBlock?.title ?? null),
        matched_url:
          found?.link ?? foundInSmartBlock?.link ?? null,
        smart_block_name: foundInSmartBlock?.blockName ?? null,
        smart_block_rank: foundInSmartBlock?.rank ?? null,
        is_reply: isReply,
        reply_since: replySince,
        updated_at: new Date().toISOString(),
      })
      .eq("id", kw.id);

    if (updateError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}` };
    }

    await saveCafeHistory(kw.id, newRank);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `[${client.name}] "${kw.keyword}" 처리 중 오류: ${msg}` };
  }
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
    .select("id, keyword, current_rank, post_url, post_title, is_reply, reply_since, matched_title")
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
    // chunk 모드: clientId + offset + limit 모두 있으면 해당 범위만 동기 처리
    if (clientId && offsetParam !== null && limitParam !== null) {
      const offset = parseInt(offsetParam, 10);
      const limit = parseInt(limitParam, 10);

      // NaN/음수/과대값 가드 (m2)
      if (!Number.isFinite(offset) || !Number.isFinite(limit) || offset < 0 || limit <= 0 || limit > 1000) {
        return NextResponse.json(
          { error: "offset(>=0) / limit(>0, <=1000) 정수 필수" },
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
      return NextResponse.json({
        message: `[${client.name}] chunk(offset=${offset}, limit=${limit}) ${result.updated}개 갱신`,
        updated: result.updated,
        errors: result.errors,
      });
    }

    // per-client 모드: 키워드 수가 임계 이상이면 chunk fan-out
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

      // 작은 client는 동기 처리
      if (total <= CHUNK_SIZE) {
        const result = await processClient(client);
        return NextResponse.json({
          message: `${result.updated}개 키워드 순위 업데이트 완료`,
          updated: result.updated,
          errors: result.errors,
        });
      }

      // 큰 client는 chunk fan-out (maxDuration 보호)
      const baseUrl = request.nextUrl.origin;
      const numChunks = Math.ceil(total / CHUNK_SIZE);

      // chunk fan-out 병렬 처리 (각 fetch는 즉시 응답, 자식은 별도 함수로 백그라운드 실행)
      const chunkOffsets: number[] = [];
      for (let off = 0; off < total; off += CHUNK_SIZE) chunkOffsets.push(off);

      after(async () => {
        await Promise.allSettled(
          chunkOffsets.map(async (off) => {
            try {
              await fetch(
                `${baseUrl}/api/cafe/batch-track?clientId=${clientId}&offset=${off}&limit=${CHUNK_SIZE}`,
                { method: "POST" }
              );
            } catch (err) {
              console.error(`[cafe/batch-track] chunk fan-out 실패 offset=${off}:`, err);
            }
          })
        );
      });

      return NextResponse.json({
        message: `[${client.name}] ${total}개 키워드 ${numChunks}개 chunk 분할 처리 시작 (after fan-out)`,
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
          await fetch(`${baseUrl}/api/cafe/batch-track?clientId=${client.id}`, { method: "POST" });
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
