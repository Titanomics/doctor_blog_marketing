import { NextRequest, NextResponse } from "next/server";
import { isJobAuthorization } from "@/lib/auth";
import { loadBlogOverview } from "@/lib/blogOverview";
import { FAILURE_LABEL, type FailureKind } from "@/lib/collectFailures";
import { loadModeHealth, type ModeHealth } from "@/lib/health";
import { loadLatestPostStats, isWinning } from "@/lib/cafePostStats";
import { sendSlack, slackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// POST /api/alerts/daily — 일일 수집 결과를 슬랙으로 보낸다 (인증: CRON_SECRET Bearer)
// ?dry=1 이면 보내지 않고 만들어진 문구만 돌려준다.
//
// 순서: 수집 상태(문제가 있으면 맨 위에 경고) → 상위권 이탈 → 새 진입 → 카페 글 요약

const LIST_MAX = 10;

function healthLine(h: ModeHealth): string {
  const parts = [`*${h.label}* ${h.collected.toLocaleString()}/${h.total.toLocaleString()} 수집`];
  if (!h.isToday) parts.push(`⚠️ 오늘 수집 기록 없음 (최근 ${h.latestDate ?? "없음"})`);
  if (h.stale > 0 && h.isToday) parts.push(`빠짐 ${h.stale}`);
  if (h.failures.keywords > 0) {
    const kinds = Object.entries(h.failures.byKind)
      .map(([k, n]) => `${FAILURE_LABEL[k as FailureKind] ?? k} ${n}`)
      .join(", ");
    parts.push(`실패 ${h.failures.keywords}건 (${kinds})`);
  }
  return `• ${parts.join(" · ")}`;
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || !isJobAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  if (!dry && !slackConfigured()) {
    return NextResponse.json({ sent: false, reason: "not_configured" });
  }

  const [blog, cafe, reporter, overview, posts] = await Promise.all([
    loadModeHealth("blog"),
    loadModeHealth("cafe"),
    loadModeHealth("reporter"),
    loadBlogOverview(),
    loadLatestPostStats(),
  ]);

  const healths = [blog, cafe, reporter];
  // 수집이 크게 실패한 경우: 네이버 수집 실패가 전체의 20% 이상이거나, 오늘 수집 기록이 없음
  const trouble = healths.filter(
    (h) => !h.isToday || (h.total > 0 && (h.failures.byKind.serp ?? 0) / h.total >= 0.2)
  );

  const lines: string[] = [];
  lines.push(`📊 *순위 수집 결과* (${blog.latestDate ?? "-"})`);
  if (trouble.length > 0) {
    lines.push(`🚨 *수집 이상*: ${trouble.map((h) => h.label).join(", ")} — 차단·장애 여부를 확인하세요. 실패한 키워드는 기존 순위를 유지합니다.`);
  }
  for (const h of healths) lines.push(healthLine(h));

  if (overview.data) {
    const { dropped, entered, totals } = overview.data;
    lines.push("");
    lines.push(`*블로그* 7위 이내 ${totals.top}개 / 전체 ${totals.keywords}개`);
    if (dropped.length > 0) {
      lines.push(`🔻 *상위권 이탈 ${dropped.length}건*`);
      for (const d of dropped.slice(0, LIST_MAX)) {
        lines.push(`   ${d.keyword} (${d.clientName}) ${d.previous}위 → ${d.current ? `${d.current}위` : "미노출"}`);
      }
      if (dropped.length > LIST_MAX) lines.push(`   외 ${dropped.length - LIST_MAX}건`);
    }
    if (entered.length > 0) {
      lines.push(`🔺 *새로 진입 ${entered.length}건*`);
      for (const d of entered.slice(0, LIST_MAX)) {
        lines.push(`   ${d.keyword} (${d.clientName}) ${d.previous ? `${d.previous}위` : "미노출"} → ${d.current}위`);
      }
      if (entered.length > LIST_MAX) lines.push(`   외 ${entered.length - LIST_MAX}건`);
    }
    if (dropped.length === 0 && entered.length === 0) lines.push("상위권 이탈·진입 없음");
  }

  if (posts.latestDate) {
    const latest = [...posts.latest.values()];
    const winning = latest.filter((p) => p.status === "alive" && isWinning(p.read_count)).length;
    // 어제는 살아 있었는데 오늘 삭제로 확인된 글
    let newlyDeleted = 0;
    for (const [key, p] of posts.latest) {
      if (p.status === "deleted" && posts.previous.get(key)?.status === "alive") newlyDeleted++;
    }
    lines.push("");
    lines.push(
      `*카페 글* (${posts.latestDate}) 관측 ${latest.length}글 · 위닝(조회수 100 이상) ${winning}글` +
        (newlyDeleted > 0 ? ` · 🗑 새로 삭제 확인 ${newlyDeleted}글` : "")
    );
  }

  const text = lines.join("\n");
  if (dry) return NextResponse.json({ sent: false, reason: "dry_run", text });

  const result = await sendSlack(text);
  return NextResponse.json(result, { status: result.sent ? 200 : 502 });
}
