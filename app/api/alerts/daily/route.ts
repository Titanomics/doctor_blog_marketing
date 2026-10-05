import { NextRequest, NextResponse } from "next/server";
import { isJobAuthorization } from "@/lib/auth";
import { FAILURE_LABEL, type FailureKind } from "@/lib/collectFailures";
import { loadModeHealth, type ModeHealth } from "@/lib/health";
import { loadLatestPostStats, isWinning, WINNING_READ_COUNT } from "@/lib/cafePostStats";
import { loadProductOverview, type ProductSide, type RankRow } from "@/lib/productOverview";
import { sendSlack, slackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// POST /api/alerts/daily — 일일 순위 결과를 슬랙으로 보낸다 (인증: CRON_SECRET Bearer)
// ?dry=1 이면 보내지 않고 만들어진 문구만 돌려준다.
//
// 제품 쪽(카페 · 블로그기자단)만, 그리고 SLACK_ALERT_BRANDS 로 지정한 브랜드만 다룬다
// (쉼표로 구분한 이름 앞부분. 기본값 "솔커트" → "솔커트", "솔커트-지역명키워드").
// 병원 블로그는 알림 대상이 아니다.
//
// 구성: 수집 상태 → 카페(특이사항 + 전체 순위) → 블로그기자단(특이사항 + 전체 순위) → 카페 글 조회수

const HIGHLIGHT_MAX = 10;
// 슬랙 메시지 하나가 너무 길어지지 않게 이 길이를 넘으면 여러 개로 나눠 보낸다
const CHUNK_CHARS = 3500;

const rankText = (r: number | null) => (r === null ? "미노출" : `${r}위`);

function changeMark(r: RankRow): string {
  if (!r.fresh) return " (오늘 수집 안 됨)";
  if (r.current === null) return "";
  if (r.previous === null) return " 🆕";
  const d = r.previous - r.current;
  if (d === 0) return "";
  return d > 0 ? ` ▲${d}` : ` ▼${-d}`;
}

function healthSummary(healths: ModeHealth[]): string[] {
  const trouble = healths.filter(
    (h) => !h.isToday || (h.total > 0 && (h.failures.byKind.serp ?? 0) / h.total >= 0.2)
  );
  const lines: string[] = [];
  if (trouble.length > 0) {
    lines.push(
      `🚨 *수집 이상*: ${trouble.map((h) => h.label).join(", ")} — 차단·장애 여부를 확인하세요. 실패한 키워드는 기존 순위를 유지합니다.`
    );
  }
  const parts = healths.map((h) => {
    let s = `${h.label} ${h.collected.toLocaleString()}/${h.total.toLocaleString()}`;
    if (!h.isToday) s += ` ⚠️오늘 기록 없음(최근 ${h.latestDate ?? "없음"})`;
    if (h.failures.keywords > 0) {
      const kinds = Object.entries(h.failures.byKind)
        .map(([k, n]) => `${FAILURE_LABEL[k as FailureKind] ?? k} ${n}`)
        .join(", ");
      s += ` · 실패 ${h.failures.keywords}건(${kinds})`;
    }
    return s;
  });
  lines.push(`수집: ${parts.join(" · ")} _(전 브랜드 기준)_`);
  return lines;
}

function highlight(title: string, rows: RankRow[]): string[] {
  if (rows.length === 0) return [];
  const lines = [`${title} ${rows.length}건`];
  for (const r of rows.slice(0, HIGHLIGHT_MAX)) {
    lines.push(`   ${r.keyword} ${rankText(r.previous)} → ${rankText(r.current)}`);
  }
  if (rows.length > HIGHLIGHT_MAX) lines.push(`   외 ${rows.length - HIGHLIGHT_MAX}건`);
  return lines;
}

function sideLines(label: string, side: ProductSide, withBrand: boolean, mainBrand: string): string[] {
  const head =
    `*${label}* 검색 노출 ${side.exposed.length}개 / 전체 ${side.rows.length}개` +
    (side.replies.length ? ` · 꼬리글 ${side.replies.length}` : "") +
    (side.deletedCount ? ` · 삭제된 글 ${side.deletedCount}` : "");
  const lines = ["", head];

  const highlights = [
    ...highlight("🆕 *새로 노출*", side.appeared),
    ...highlight("🔻 *노출 이탈*", side.disappeared),
    ...highlight("🔺 *3계단 이상 상승*", side.rose),
    ...highlight("↘️ *3계단 이상 하락*", side.fell),
  ];
  lines.push(...(highlights.length ? highlights : ["특이사항 없음"]));

  // 전체 순위 (노출 중인 것 전부)
  if (side.exposed.length > 0) {
    lines.push("📋 *전체 순위*");
    for (const r of side.exposed) {
      // 브랜드가 여럿일 때, 대표 브랜드가 아닌 것만 이름을 붙인다
      const tag = withBrand && r.brand !== mainBrand ? ` (${r.brand})` : "";
      lines.push(`   ${String(r.current).padStart(2)}위  ${r.keyword}${tag}${changeMark(r)}`);
    }
  }
  if (side.replies.length > 0) lines.push(`꼬리글: ${side.replies.map((r) => r.keyword).join(", ")}`);
  if (side.unexposed.length > 0) {
    lines.push(`미노출 ${side.unexposed.length}개: ${side.unexposed.map((r) => r.keyword).join(", ")}`);
  }
  return lines;
}

// 줄 단위로 끊어 여러 메시지로 나눈다
function chunk(lines: string[]): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of lines) {
    // 한 줄이 너무 길면(미노출 목록 등) 쉼표에서 끊는다
    const pieces: string[] = [];
    let rest = line;
    while (rest.length > CHUNK_CHARS) {
      const cut = rest.lastIndexOf(", ", CHUNK_CHARS);
      const at = cut > 0 ? cut + 1 : CHUNK_CHARS;
      pieces.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    pieces.push(rest);
    for (const p of pieces) {
      if (buf && buf.length + p.length + 1 > CHUNK_CHARS) {
        out.push(buf);
        buf = "";
      }
      buf += (buf ? "\n" : "") + p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || !isJobAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  if (!dry && !slackConfigured()) {
    return NextResponse.json({ sent: false, reason: "not_configured" });
  }

  const prefixes = (process.env.SLACK_ALERT_BRANDS ?? "솔커트")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [cafeHealth, reporterHealth, product, posts] = await Promise.all([
    loadModeHealth("cafe"),
    loadModeHealth("reporter"),
    loadProductOverview(prefixes),
    loadLatestPostStats(),
  ]);

  const withBrand = product.brands.length > 1;
  const lines: string[] = [];
  lines.push(`📊 *${prefixes.join("·") || "제품"} 순위* (${cafeHealth.latestDate ?? "-"})${withBrand ? ` — ${product.brands.join(", ")}` : ""}`);
  lines.push(...healthSummary([cafeHealth, reporterHealth]));

  const mainBrand = product.brands[0] ?? "";
  lines.push(...sideLines("카페", product.cafe, withBrand, mainBrand));
  lines.push(...sideLines("블로그기자단", product.reporter, withBrand, mainBrand));

  if (posts.latestDate) {
    // 이 브랜드의 글만
    const mine = [...posts.latest].filter(([key]) => product.postKeys.has(key));
    const winning = mine.filter(([, p]) => p.status === "alive" && isWinning(p.read_count)).length;
    const restricted = mine.filter(([, p]) => p.status === "alive" && p.read_count === null).length;
    let newlyDeleted = 0;
    const gains: { key: string; delta: number; total: number }[] = [];
    for (const [key, p] of mine) {
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
      `*카페 글 조회수* (${posts.latestDate}) 관측 ${mine.length}글 · 위닝(조회수 ${WINNING_READ_COUNT} 이상) ${winning}글` +
        (restricted ? ` · 회원 전용(조회수 비공개) ${restricted}글` : "") +
        (newlyDeleted > 0 ? ` · 🗑 새로 삭제 확인 ${newlyDeleted}글` : "")
    );
    if (gains.length > 0) {
      lines.push("📈 *전날 대비 조회수 증가*");
      for (const g of gains.slice(0, 10)) {
        lines.push(`   +${g.delta.toLocaleString()} (누적 ${g.total.toLocaleString()}) <https://cafe.naver.com/${g.key}|글 열기>`);
      }
    }
  }

  const messages = chunk(lines);
  if (dry) return NextResponse.json({ sent: false, reason: "dry_run", messages });

  for (let i = 0; i < messages.length; i++) {
    const result = await sendSlack(messages[i]);
    if (!result.sent) {
      return NextResponse.json({ ...result, sentMessages: i, totalMessages: messages.length }, { status: 502 });
    }
  }
  return NextResponse.json({ sent: true, messages: messages.length });
}
