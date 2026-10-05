import { NextRequest, NextResponse } from "next/server";
import { isJobAuthorization } from "@/lib/auth";
import { FAILURE_LABEL, type FailureKind } from "@/lib/collectFailures";
import { loadModeHealth, type ModeHealth } from "@/lib/health";
import { loadLatestPostStats, isWinning, WINNING_READ_COUNT } from "@/lib/cafePostStats";
import { loadProductOverview, type ProductSide, type RankMove } from "@/lib/productOverview";
import { sendSlack, slackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// POST /api/alerts/daily — 일일 수집 결과를 슬랙으로 보낸다 (인증: CRON_SECRET Bearer)
// ?dry=1 이면 보내지 않고 만들어진 문구만 돌려준다.
//
// 제품 쪽(카페 · 블로그기자단)만 다룬다. 병원 블로그는 알림 대상이 아니다.
// 순서: 수집 상태(문제가 있으면 맨 위에 경고) → 카페 변동 → 기자단 변동 → 카페 글(조회수·삭제)

const LIST_MAX = 8;
const rank = (r: number | null) => (r === null ? "미노출" : `${r}위`);

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

function moveLines(title: string, moves: RankMove[]): string[] {
  if (moves.length === 0) return [];
  const lines = [`${title} ${moves.length}건`];
  for (const m of moves.slice(0, LIST_MAX)) {
    lines.push(`   ${m.keyword}${m.brand ? ` (${m.brand})` : ""} ${rank(m.previous)} → ${rank(m.current)}`);
  }
  if (moves.length > LIST_MAX) lines.push(`   외 ${moves.length - LIST_MAX}건`);
  return lines;
}

function sideLines(label: string, unit: string, side: ProductSide): string[] {
  const lines = ["", `*${label}* 검색 노출 ${side.exposed}${unit} / 전체 ${side.total}${unit}`];
  const up = side.moved.filter((m) => m.current! < m.previous!);
  const down = side.moved.filter((m) => m.current! > m.previous!).reverse();
  const body = [
    ...moveLines("🆕 *새로 노출*", side.appeared),
    ...moveLines("🔻 *노출 이탈*", side.disappeared),
    ...moveLines("🔺 *3계단 이상 상승*", up),
    ...moveLines("↘️ *3계단 이상 하락*", down),
  ];
  return [...lines, ...(body.length ? body : ["변동 없음"])];
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || !isJobAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  if (!dry && !slackConfigured()) {
    return NextResponse.json({ sent: false, reason: "not_configured" });
  }

  const [cafe, reporter, product, posts] = await Promise.all([
    loadModeHealth("cafe"),
    loadModeHealth("reporter"),
    loadProductOverview(),
    loadLatestPostStats(),
  ]);

  const healths = [cafe, reporter];
  // 수집이 크게 실패한 경우: 네이버 수집 실패가 전체의 20% 이상이거나, 오늘 수집 기록이 없음
  const trouble = healths.filter(
    (h) => !h.isToday || (h.total > 0 && (h.failures.byKind.serp ?? 0) / h.total >= 0.2)
  );

  const lines: string[] = [];
  lines.push(`📊 *제품 순위 수집 결과* (${cafe.latestDate ?? "-"})`);
  if (trouble.length > 0) {
    lines.push(
      `🚨 *수집 이상*: ${trouble.map((h) => h.label).join(", ")} — 차단·장애 여부를 확인하세요. 실패한 키워드는 기존 순위를 유지합니다.`
    );
  }
  for (const h of healths) lines.push(healthLine(h));

  lines.push(...sideLines("카페", "개", product.cafe));
  lines.push(...sideLines("블로그기자단", "개", product.reporter));

  if (posts.latestDate) {
    const latest = [...posts.latest.values()];
    const alive = latest.filter((p) => p.status === "alive");
    const winning = alive.filter((p) => isWinning(p.read_count)).length;
    // 전날은 살아 있었는데 오늘 삭제로 확인된 글
    let newlyDeleted = 0;
    // 전날 대비 조회수가 가장 많이 늘어난 글
    const gains: { key: string; delta: number; total: number }[] = [];
    for (const [key, p] of posts.latest) {
      const prev = posts.previous.get(key);
      if (p.status === "deleted" && prev?.status === "alive") newlyDeleted++;
      if (p.status === "alive" && prev?.status === "alive" && p.read_count !== null && prev.read_count !== null) {
        const delta = p.read_count - prev.read_count;
        if (delta > 0) gains.push({ key, delta, total: p.read_count });
      }
    }
    gains.sort((a, b) => b.delta - a.delta);

    lines.push("");
    lines.push(
      `*카페 글* (${posts.latestDate}) 관측 ${latest.length}글 · 위닝(조회수 ${WINNING_READ_COUNT} 이상) ${winning}글` +
        (newlyDeleted > 0 ? ` · 🗑 새로 삭제 확인 ${newlyDeleted}글` : "")
    );
    if (gains.length > 0) {
      lines.push("📈 *전날 대비 조회수 증가*");
      for (const g of gains.slice(0, 5)) {
        lines.push(`   +${g.delta.toLocaleString()} (누적 ${g.total.toLocaleString()}) <https://cafe.naver.com/${g.key}|글 열기>`);
      }
    }
  }

  const text = lines.join("\n");
  if (dry) return NextResponse.json({ sent: false, reason: "dry_run", text });

  const result = await sendSlack(text);
  return NextResponse.json(result, { status: result.sent ? 200 : 502 });
}
