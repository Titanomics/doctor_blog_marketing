import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseReplies } from "@/lib/parseNaver";
import { fetchNaverSerp } from "@/lib/naverSerp";
import { cafeRefToUrl, parseCafeRef, resolveCafeTarget, sameCafeArticle } from "@/lib/naverUrl";
import { saveCafeHistory } from "@/lib/saveCafeHistory";
import { internalAuthHeaders } from "@/lib/auth";
import { getCafePostStatus, type CafePostStatus } from "@/lib/checkCafePostDeleted";

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

// 삭제 확인된 글의 재확인 요일: id에서 0~6을 뽑아 KST 날짜와 맞는 날만 true (글들이 7일에 고르게 분산)
function isWeeklyRecheckDay(id: string, nowMs: number = Date.now()): boolean {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  const kstDay = Math.floor((nowMs + 9 * 60 * 60 * 1000) / 86_400_000);
  return (sum + kstDay) % 7 === 0;
}

// 단일 키워드 처리 (병렬 호출 가능 단위)
async function processKeyword(
  client: { id: string; name: string },
  kw: CafeKeywordRow
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 수집 실패 시에는 DB를 건드리지 않는다 (기존 순위 유지, "미노출"로 덮어쓰지 않음)
    const serp = await fetchNaverSerp(kw.keyword);
    if (!serp.ok) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" ${serp.reason} — 기존 순위 유지` };
    }
    const { results, smartBlockResults } = serp;
    const replyResults = parseReplies(serp.html);

    // 등록 URL이 글 URL(직접 또는 naver.me)이면 카페·글 번호 완전일치로만 매칭한다.
    // 글 URL이 아닐 때만 제목 포함 여부로 매칭.
    const targetRef = await resolveCafeTarget(kw.post_url);
    if (targetRef === "unresolved") {
      // 단축 URL을 일시적으로 해석하지 못함 — 어느 글인지 모르는 채로 "미노출"을 저장하지 않는다
      return { ok: false, error: `[${client.name}] "${kw.keyword}" 단축 URL 해석 실패 — 기존 순위 유지` };
    }
    const hasSpecificPostId = !!targetRef;
    const postTitle = kw.post_title?.toLowerCase() || null;

    const matchLink = (link: string, text: string | undefined) => {
      const ref = parseCafeRef(link); // 카페 글 링크가 아니면 null (블로그/외부 사이트 제외)
      if (!ref) return false;
      if (targetRef) return sameCafeArticle(ref, targetRef);
      return !!(postTitle && text && text.toLowerCase().includes(postTitle));
    };

    const found = results.find((r) => matchLink(r.link, r.title)) ?? null;
    const foundInSmartBlock = smartBlockResults.find((r) => matchLink(r.link, r.title)) ?? null;

    let foundInReply = null;
    if (!found && !foundInSmartBlock) {
      foundInReply = replyResults.find((r) => matchLink(r.link, r.text)) ?? null;
    }

    const newRank = found ? found.rank : null;
    const isReply = !!foundInReply && !found && !foundInSmartBlock;

    let replySince = kw.reply_since;
    if (isReply && !kw.is_reply) {
      replySince = new Date().toISOString();
    } else if (!isReply) {
      replySince = null;
    }

    const wasMarkedDeleted = kw.matched_title === "[삭제된 게시글]";
    const noMatchFound = !found && !foundInSmartBlock && !foundInReply;

    // 검색에 없는 글만 상태를 조회한다. 이미 삭제로 확인된 글은 매일 다시 묻지 않고
    // 글마다 정해진 요일에 주 1회만 재확인한다 (네이버 조회량 절감).
    let postStatus: CafePostStatus | null = null;
    const canonicalUrl = targetRef ? cafeRefToUrl(targetRef) : null;
    if (
      hasSpecificPostId &&
      noMatchFound &&
      canonicalUrl &&
      (!wasMarkedDeleted || isWeeklyRecheckDay(kw.id))
    ) {
      postStatus = await getCafePostStatus(canonicalUrl);
    }
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

    const historyError = await saveCafeHistory(kw.id, newRank);
    if (historyError) {
      return { ok: false, error: `[${client.name}] "${kw.keyword}" 이력 저장 실패: ${historyError}` };
    }
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

  // 키워드당 10초 간격 — 네이버 차단 회피
  for (let i = 0; i < keywords.length; i++) {
    const r = await processKeyword(client, keywords[i]);
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
