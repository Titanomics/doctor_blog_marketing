// 일일 순위 수집을 GitHub Actions 러너에서 직접 실행한다 (Vercel 함수의 300초 제한·chunk·체인 없이).
//
// 실행: npx tsx scripts/daily-batch.mts --mode blog|cafe|reporter [--limit N] [--interval 초] [--force]
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// - 시작할 때 대상 목록을 한 번 확정하고 한 줄로 순서대로 처리한다 (요청 간격 기본 10초).
// - 오늘(KST) 이미 수집된 키워드는 건너뛴다 → 중단된 뒤 다시 실행하면 남은 것만 이어서 한다.
//   --force 를 주면 전부 다시 수집한다.
// - 네이버 수집 실패가 연속으로 이어지면 차단으로 보고 중단한다 (계속 두드리지 않음).
// - 공개 저장소라 로그에는 병원명·키워드를 찍지 않고 집계 숫자만 남긴다.

import fs from "node:fs";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";
import { BLOG_KEYWORD_COLUMNS, processBlogKeyword, type BlogKeywordRow } from "@/lib/batch/blog";
import { CAFE_KEYWORD_COLUMNS, processCafeKeyword, type CafeKeywordRow } from "@/lib/batch/cafe";
import { processReporterKeyword } from "@/lib/batch/reporter";

type Mode = "blog" | "cafe" | "reporter";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = arg("mode") as Mode;
const limit = arg("limit") ? Math.max(1, parseInt(arg("limit")!, 10)) : Infinity;
const intervalMs = Math.max(1, parseFloat(arg("interval") ?? "10")) * 1000;
const force = args.includes("--force");

if (!["blog", "cafe", "reporter"].includes(mode)) {
  console.error("--mode blog|cafe|reporter 가 필요합니다.");
  process.exit(2);
}

// 연속으로 이만큼 네이버 수집에 실패하면 중단
const MAX_CONSECUTIVE_SERP_FAILURES = 8;
// 작업 제한 시간(기본 5시간 30분) 안에서 멈추고, 남은 것은 다음 실행에 맡긴다
const TIME_BUDGET_MS = (parseFloat(process.env.BATCH_BUDGET_MINUTES ?? "330") || 330) * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = getKSTDateString();
const isToday = (iso: string | null) => !!iso && getKSTDateString(new Date(iso)) === today;

// 오류 메시지에는 병원명·키워드가 들어 있어 로그에 그대로 찍지 않고 종류만 센다
function errorKind(message: string): string {
  if (message.includes("시간 초과")) return "네이버 시간 초과";
  if (message.includes("네이버 검색 실패")) return "네이버 HTTP 오류";
  if (message.includes("읽지 못함")) return "검색 화면 판독 실패(차단·구조 변경 의심)";
  if (message.includes("요청 오류")) return "네이버 요청 오류";
  if (message.includes("단축 URL")) return "단축 URL 해석 실패";
  if (message.includes("이력 저장 실패")) return "이력 저장 실패";
  if (message.includes("DB 업데이트 실패")) return "DB 저장 실패";
  return "기타";
}

interface Job {
  run: () => Promise<{ ok: boolean; serpFailed: boolean; errors: string[] }>;
}

async function buildJobs(): Promise<{ jobs: Job[]; total: number; skipped: number }> {
  const jobs: Job[] = [];
  let total = 0;
  let skipped = 0;

  if (mode === "blog") {
    const clients = await fetchAll<{ id: string; name: string; blog_url: string }>((from, to) =>
      supabase.from("clients").select("id, name, blog_url").order("id").range(from, to)
    );
    if (clients.error) throw new Error(`clients 조회 실패: ${clients.error}`);
    const byId = new Map(clients.data.map((c) => [c.id, c]));
    const keywords = await fetchAll<BlogKeywordRow & { client_id: string }>((from, to) =>
      supabase.from("keywords").select(`client_id, ${BLOG_KEYWORD_COLUMNS}`).order("client_id").order("id").range(from, to)
    );
    if (keywords.error) throw new Error(`keywords 조회 실패: ${keywords.error}`);
    for (const kw of keywords.data) {
      const client = byId.get(kw.client_id);
      if (!client) continue;
      total++;
      if (!force && isToday(kw.updated_at)) {
        skipped++;
        continue;
      }
      jobs.push({
        run: async () => {
          const r = await processBlogKeyword(client, kw);
          return { ok: r.ok, serpFailed: !!r.serpFailed, errors: r.error ? [r.error] : [] };
        },
      });
    }
  } else if (mode === "cafe") {
    const clients = await fetchAll<{ id: string; name: string }>((from, to) =>
      supabase.from("cafe_clients").select("id, name").order("id").range(from, to)
    );
    if (clients.error) throw new Error(`cafe_clients 조회 실패: ${clients.error}`);
    const byId = new Map(clients.data.map((c) => [c.id, c]));
    const keywords = await fetchAll<CafeKeywordRow & { client_id: string }>((from, to) =>
      supabase.from("cafe_keywords").select(`client_id, ${CAFE_KEYWORD_COLUMNS}`).order("client_id").order("id").range(from, to)
    );
    if (keywords.error) throw new Error(`cafe_keywords 조회 실패: ${keywords.error}`);
    for (const kw of keywords.data) {
      const client = byId.get(kw.client_id);
      if (!client) continue;
      total++;
      if (!force && isToday(kw.updated_at)) {
        skipped++;
        continue;
      }
      jobs.push({
        run: async () => {
          const r = await processCafeKeyword(client, kw);
          return { ok: r.ok, serpFailed: !!r.serpFailed, errors: r.error ? [r.error] : [] };
        },
      });
    }
  } else {
    // 기자단: 키워드 하나에 등록된 글이 여러 개. 검색은 키워드당 1회.
    const clients = await fetchAll<{ id: string; name: string }>((from, to) =>
      supabase.from("cafe_clients").select("id, name").order("id").range(from, to)
    );
    if (clients.error) throw new Error(`cafe_clients 조회 실패: ${clients.error}`);
    const byId = new Map(clients.data.map((c) => [c.id, c]));
    const keywords = await fetchAll<{ id: string; keyword: string; client_id: string }>((from, to) =>
      supabase.from("reporter_keywords").select("id, keyword, client_id").order("client_id").order("id").range(from, to)
    );
    if (keywords.error) throw new Error(`reporter_keywords 조회 실패: ${keywords.error}`);
    const entries = await fetchAll<{ keyword_id: string; updated_at: string | null }>((from, to) =>
      supabase.from("reporter_blog_entries").select("keyword_id, updated_at").order("id").range(from, to)
    );
    if (entries.error) throw new Error(`reporter_blog_entries 조회 실패: ${entries.error}`);
    // 키워드에 딸린 글이 모두 오늘 갱신됐으면 그 키워드는 끝난 것
    const pendingKeyword = new Set<string>();
    const hasEntries = new Set<string>();
    for (const e of entries.data) {
      hasEntries.add(e.keyword_id);
      if (force || !isToday(e.updated_at)) pendingKeyword.add(e.keyword_id);
    }
    for (const kw of keywords.data) {
      const client = byId.get(kw.client_id);
      if (!client || !hasEntries.has(kw.id)) continue;
      total++;
      if (!pendingKeyword.has(kw.id)) {
        skipped++;
        continue;
      }
      jobs.push({
        run: async () => {
          const r = await processReporterKeyword(client, kw);
          return { ok: r.errors.length === 0, serpFailed: !!r.serpFailed, errors: r.errors };
        },
      });
    }
  }
  return { jobs, total, skipped };
}

const startedAt = Date.now();
const { jobs, total, skipped } = await buildJobs();
const planned = Math.min(jobs.length, limit);
console.log(`[${mode}] ${today} 대상 ${total}건 / 오늘 이미 수집 ${skipped}건 / 이번 실행 ${planned}건 (간격 ${intervalMs / 1000}초)`);

let done = 0;
let ok = 0;
let failed = 0;
let serpFailures = 0;
let consecutiveSerp = 0;
let stopped: string | null = null;
const kinds: Record<string, number> = {};

for (const job of jobs.slice(0, planned)) {
  if (Date.now() - startedAt > TIME_BUDGET_MS) {
    stopped = "시간 제한";
    break;
  }
  if (done > 0) await sleep(intervalMs);
  const r = await job.run();
  done++;
  if (r.ok) ok++;
  else failed++;
  for (const e of r.errors) kinds[errorKind(e)] = (kinds[errorKind(e)] ?? 0) + 1;

  if (r.serpFailed) {
    serpFailures++;
    if (++consecutiveSerp >= MAX_CONSECUTIVE_SERP_FAILURES) {
      stopped = `네이버 수집 연속 ${consecutiveSerp}회 실패 (차단·장애 의심)`;
      break;
    }
  } else {
    consecutiveSerp = 0;
  }
  if (done % 25 === 0) console.log(`[${mode}] ${done}/${planned} 처리 (성공 ${ok}, 실패 ${failed})`);
}

const summary = {
  mode,
  date: today,
  total,
  skippedAlreadyDone: skipped,
  processed: done,
  ok,
  failed,
  serpFailures,
  remaining: jobs.length - done,
  errorKinds: kinds,
  stopped,
  elapsedMinutes: +((Date.now() - startedAt) / 60_000).toFixed(1),
};
console.log("SUMMARY " + JSON.stringify(summary));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### 일일 수집 (${mode}) — ${today}`,
      "",
      `- 대상 ${total}건 중 이번 실행 ${done}건 처리: 성공 **${ok}**, 실패 ${failed} (그중 네이버 수집 실패 ${serpFailures})`,
      `- 오늘 이미 수집돼 건너뜀 ${skipped}건, 남은 것 ${summary.remaining}건`,
      `- 오류 종류: \`${JSON.stringify(kinds)}\``,
      `- 소요 ${summary.elapsedMinutes}분${stopped ? ` · **중단: ${stopped}**` : ""}`,
      "",
    ].join("\n")
  );
}

// 차단 의심으로 중단했으면 실패로 표시한다. 시간 제한으로 멈춘 것은 다시 실행하면 이어지므로 성공.
process.exit(stopped && stopped !== "시간 제한" ? 1 : 0);
