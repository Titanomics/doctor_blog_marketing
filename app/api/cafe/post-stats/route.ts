import { NextRequest, NextResponse } from "next/server";
import { isJobAuthorization } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchCafePost } from "@/lib/cafePost";
import { isWeeklyRecheckDay, postKey } from "@/lib/cafePostStats";
import { getKSTDateString } from "@/lib/dateUtils";
import { resolveCafeTarget } from "@/lib/naverUrl";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// 카페 글 일별 관측 수집 (조회수·댓글 수·생존 여부).
// 호출 예: POST /api/cafe/post-stats?limit=100   (인증: CRON_SECRET Bearer)
//
// 작업 목록은 offset이 아니라 "오늘 관측이 아직 없는 글"이다.
// 그래서 여러 번 불러도 같은 글을 다시 조회하지 않고, 중단 후 다시 불러도 이어서 진행된다.
// 응답의 remaining 이 0이 될 때까지 반복 호출한다. saved 가 0이면 더 불러도 진전이 없다는 뜻.

const DELETED_TITLE = "[삭제된 게시글]";
const REQUEST_INTERVAL_MS = 1000;
const TIME_BUDGET_MS = 230_000;
// 연속으로 이만큼 unknown 이면 차단·장애로 보고 중단한다 (계속 두드리지 않음)
const MAX_CONSECUTIVE_UNKNOWN = 5;
// 한 번의 호출에서 새로 해석하는 naver.me / 숫자 ID URL 수
const MAX_NETWORK_RESOLVES = 60;

type KeywordRow = {
  id: string;
  post_url: string | null;
  matched_title: string | null;
  post_cafe: string | null;
  post_article_id: string | null;
  post_ref_url: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadKeywords(): Promise<KeywordRow[] | string> {
  const rows: KeywordRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("cafe_keywords")
      .select("id, post_url, matched_title, post_cafe, post_article_id, post_ref_url")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) return error.message;
    rows.push(...(data as KeywordRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// post_url → (cafe, article_id) 매핑을 cafe_keywords 에 보존한다.
// post_ref_url 은 그 매핑을 만들 때의 post_url — 값이 달라지면(URL 수정) 다시 해석한다.
// 일시적 해석 실패(unresolved)는 기록하지 않아 다음 호출에서 재시도된다.
async function refreshMappings(rows: KeywordRow[], deadline: number) {
  let networkResolves = 0;
  let unresolved = 0;
  for (const row of rows) {
    if (!row.post_url || row.post_ref_url === row.post_url) continue;
    if (Date.now() > deadline) break;

    const needsNetwork = !/cafe\.naver\.com\/[A-Za-z0-9_-]+\/\d+/.test(row.post_url);
    if (needsNetwork) {
      if (networkResolves >= MAX_NETWORK_RESOLVES) continue;
      networkResolves++;
    }

    const ref = await resolveCafeTarget(row.post_url);
    if (ref === "unresolved") {
      unresolved++;
      continue;
    }
    const cafe = ref?.cafe ?? null;
    const articleId = ref && cafe ? ref.articleId : null;
    const { error } = await supabase
      .from("cafe_keywords")
      .update({ post_cafe: cafe, post_article_id: articleId, post_ref_url: row.post_url })
      .eq("id", row.id);
    if (!error) {
      row.post_cafe = cafe;
      row.post_article_id = articleId;
      row.post_ref_url = row.post_url;
    }
  }
  return { unresolved };
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || !isJobAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(200, parseInt(limitParam ?? "100", 10) || 100));
  const today = getKSTDateString();

  const loaded = await loadKeywords();
  if (typeof loaded === "string") {
    return NextResponse.json({ error: `cafe_keywords 조회 실패: ${loaded}` }, { status: 500 });
  }

  const { unresolved } = await refreshMappings(loaded, deadline);

  // 고유 글 목록. 그 글을 가리키는 키워드가 전부 삭제 표시면 "삭제 확인된 글"로 본다.
  const posts = new Map<string, { cafe: string; articleId: string; allDeleted: boolean }>();
  for (const row of loaded) {
    if (!row.post_cafe || !row.post_article_id || row.post_ref_url !== row.post_url) continue;
    const key = postKey(row.post_cafe, row.post_article_id);
    const deleted = row.matched_title === DELETED_TITLE;
    const prev = posts.get(key);
    if (prev) prev.allDeleted = prev.allDeleted && deleted;
    else posts.set(key, { cafe: row.post_cafe, articleId: row.post_article_id, allDeleted: deleted });
  }

  // 오늘의 대상: 살아 있는 글 전부 + 삭제 확인된 글 중 오늘이 재확인 요일인 것
  const targets = [...posts.entries()].filter(
    ([key, p]) => !p.allDeleted || isWeeklyRecheckDay(key)
  );

  const done = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("cafe_post_stats")
      .select("cafe, article_id")
      .eq("tracked_date", today)
      .range(from, from + 999);
    if (error) {
      return NextResponse.json({ error: `cafe_post_stats 조회 실패: ${error.message}` }, { status: 500 });
    }
    for (const r of data ?? []) done.add(postKey(r.cafe, r.article_id));
    if (!data || data.length < 1000) break;
  }

  const pending = targets.filter(([key]) => !done.has(key));

  let processed = 0;
  let saved = 0;
  let failed = 0;
  let consecutiveUnknown = 0;
  let stopped: string | null = null;

  for (const [, post] of pending.slice(0, limit)) {
    if (Date.now() > deadline) {
      stopped = "time_budget";
      break;
    }
    if (processed > 0) await sleep(REQUEST_INTERVAL_MS);
    processed++;

    const obs = await fetchCafePost(post.cafe, post.articleId);
    if (obs.status === "unknown") {
      // 유효 관측이 아니므로 저장하지 않는다 (0이나 이전 값으로 채우지 않음)
      failed++;
      if (++consecutiveUnknown >= MAX_CONSECUTIVE_UNKNOWN) {
        stopped = "consecutive_failures";
        break;
      }
      continue;
    }
    consecutiveUnknown = 0;

    const { error } = await supabase.from("cafe_post_stats").upsert(
      {
        cafe: post.cafe,
        article_id: post.articleId,
        tracked_date: today,
        status: obs.status,
        read_count: obs.status === "alive" ? obs.readCount : null,
        comment_count: obs.status === "alive" ? obs.commentCount : null,
        club_id: obs.status === "alive" ? obs.clubId : null,
        member_count: obs.status === "alive" ? obs.memberCount : null,
        observed_at: new Date().toISOString(),
      },
      { onConflict: "cafe,article_id,tracked_date" }
    );
    if (error) {
      failed++;
      console.error(`[post-stats] 저장 실패 ${post.cafe}/${post.articleId}: ${error.message}`);
    } else {
      saved++;
    }
  }

  return NextResponse.json({
    date: today,
    posts: posts.size,
    targets: targets.length,
    alreadyDone: done.size,
    processed,
    saved,
    failed,
    remaining: pending.length - saved,
    unresolvedUrls: unresolved,
    stopped,
    elapsedMs: Date.now() - startedAt,
  });
}
