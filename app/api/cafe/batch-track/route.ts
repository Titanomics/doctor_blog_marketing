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
async function processClient(client: { id: string; name: string }) {
  let updated = 0;
  const errors: string[] = [];

  const { data: keywords, error: kwError } = await supabase
    .from("cafe_keywords")
    .select("id, keyword, current_rank, post_url, post_title, is_reply, reply_since, matched_title")
    .eq("client_id", client.id);

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
        message: `${result.updated}개 키워드 순위 업데이트 완료`,
        updated: result.updated,
        errors: result.errors,
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
