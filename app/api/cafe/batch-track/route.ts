import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseViewSection, parseSmartBlocks, parseReplies } from "@/lib/parseNaver";
import { saveCafeHistory } from "@/lib/saveCafeHistory";
import { getCafePostStatus, type CafePostStatus } from "@/lib/checkCafePostDeleted";

export const maxDuration = 300;

const DELAY_MS = 800;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 단일 클라이언트 키워드 처리 (네이버 직접 호출)
async function processClient(client: { id: string; name: string }) {
  let updated = 0;
  const errors: string[] = [];

  const { data: keywords, error: kwError } = await supabase
    .from("cafe_keywords")
    .select("id, keyword, current_rank, post_url, post_title, is_reply, reply_since, matched_title")
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
      const replyResults = parseReplies(html);

      // 매칭 로직 (cafe/search와 동일)
      const normalize = (link: string) =>
        link.replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com");
      const normalizedPostUrl = kw.post_url
        ? kw.post_url.trim().replace(/^https?:\/\/m\.cafe\.naver\.com/, "https://cafe.naver.com")
        : null;

      // 특정 게시글 URL(숫자 ID 포함)이 있으면 URL로만 매칭
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

      // 꼬리글 상태 전환 로직
      // - 새로 꼬리글 진입: reply_since를 현재 시각으로 기록
      // - 꼬리글 유지: 기존 reply_since 보존
      // - 꼬리글에서 빠져나오거나 처음부터 일반: reply_since를 null로 리셋
      let replySince = kw.reply_since;
      if (isReply && !kw.is_reply) {
        replySince = new Date().toISOString();
      } else if (!isReply) {
        replySince = null;
      }

      // 어디에서도 못 찾고 특정 게시글 URL이 있으면 게시글 상태 확인 (정규화된 URL)
      let postStatus: CafePostStatus | null = null;
      if (hasSpecificPostId && !found && !foundInSmartBlock && !foundInReply && normalizedPostUrl) {
        postStatus = await getCafePostStatus(normalizedPostUrl);
      }

      // 삭제표시 유지 조건 (3-state 기반):
      // - 'deleted' 명시 확인  → 항상 표시 (자동/수동 무관)
      // - 'alive' 명시 확인    → 명시적 갱신 (보존하지 않음)
      // - 'unknown' or 검사 안함 + 매칭 실패 + 기존 표시 → 보존
      //   ('unknown'은 일시적 API 장애 가능성, 수동 토글 가능성 모두 흡수)
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
        errors.push(`[${client.name}] "${kw.keyword}" DB 업데이트 실패: ${updateError.message}`);
      } else {
        await saveCafeHistory(kw.id, newRank);
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

    // clientId 없으면 팬아웃: 클라이언트별로 fire-and-forget
    const baseUrl = request.nextUrl.origin;
    const { data: clients, error: clientsError } = await supabase
      .from("cafe_clients")
      .select("id, name");

    if (clientsError) throw clientsError;
    if (!clients || clients.length === 0) {
      return NextResponse.json({ message: "등록된 브랜드가 없습니다.", updated: 0 });
    }

    for (const client of clients) {
      fetch(`${baseUrl}/api/cafe/batch-track?clientId=${client.id}`, { method: "POST" }).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 2000));

    return NextResponse.json({
      message: `${clients.length}개 브랜드 배치 시작`,
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
