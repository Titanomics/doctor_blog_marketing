"use client";

import { useEffect, useState } from "react";

// 전체 홈의 "수집 상태" 구역.
// 순위 수집이 최근 언제 돌았는지, 몇 개가 빠졌는지, 무엇 때문에 실패했는지를 보여준다.

interface FailureItem {
  keyword: string;
  clientName: string;
  kind: string;
  kindLabel: string;
  detail: string | null;
  occurredAt: string;
}

interface ModeHealth {
  mode: string;
  label: string;
  total: number;
  latestDate: string | null;
  isToday: boolean;
  collected: number;
  stale: number;
  firstAt: string | null;
  lastAt: string | null;
  failures: {
    available: boolean;
    events: number;
    keywords: number;
    byKind: Record<string, number>;
    items: FailureItem[];
  };
  coverage: { date: string; rows: number }[];
}

interface HealthResponse {
  modes: ModeHealth[];
  postStats?: { date: string; isToday: boolean; observed: number; withViews: number; restricted: number; deleted: number } | null;
}

const KIND_LABEL: Record<string, string> = {
  serp: "네이버 수집 실패",
  resolve: "등록 URL 해석 실패",
  db: "순위 저장 실패",
  history: "이력 저장 실패",
  other: "기타 오류",
};

const fmt = (n: number) => n.toLocaleString("ko-KR");

function timeOf(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
}

function shortDate(date: string | null) {
  if (!date) return "-";
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 최근 14일 날짜별 이력 건수 막대. 높이는 그 기간 최댓값 기준이고, 0건인 날은 빨간 밑줄로 표시한다.
function CoverageBars({ coverage, accent }: { coverage: ModeHealth["coverage"]; accent: string }) {
  const W = 168;
  const H = 30;
  const max = Math.max(1, ...coverage.map((c) => c.rows));
  const slot = W / coverage.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최근 14일 날짜별 수집 건수" className="block">
      {coverage.map((c, i) => {
        const h = Math.round((c.rows / max) * (H - 4));
        return (
          <g key={c.date}>
            <title>{`${c.date}: ${fmt(c.rows)}건`}</title>
            {/* 마우스를 올리기 쉽게 칸 전체를 잡는다 */}
            <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
            {c.rows > 0 ? (
              <rect x={i * slot + 1} y={H - h} width={slot - 2} height={h} rx={2} fill={accent} opacity={i === coverage.length - 1 ? 1 : 0.55} />
            ) : (
              <rect x={i * slot + 1} y={H - 2} width={slot - 2} height={2} fill="#f87171" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function HealthSection({ mode }: { mode: "blog" | "cafe" }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const accent = mode === "blog" ? "#10b981" : "#8b5cf6";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/health?mode=${mode}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-slate-800">수집 상태</h2>
        <span className="text-[11px] text-slate-400">
          가장 최근 수집일 기준 · 실패한 키워드는 기존 순위를 유지합니다 · 막대 = 최근 14일 날짜별 저장 건수
        </span>
      </div>

      {failed && <div className="px-5 py-6 text-sm text-slate-400">수집 상태를 불러오지 못했습니다.</div>}
      {!data && !failed && <div className="px-5 py-6 text-sm text-slate-400">불러오는 중...</div>}

      {data?.modes.map((m) => {
        const pct = m.total > 0 ? Math.round((m.collected / m.total) * 100) : 0;
        const kinds = Object.entries(m.failures.byKind);
        const isOpen = open === m.mode;
        return (
          <div key={m.mode} className="border-b border-slate-50 last:border-b-0">
            <div className="px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="w-24 text-sm font-semibold text-slate-700">{m.label}</div>

              <div className="min-w-[150px]">
                <div className="text-xs text-slate-500">
                  최근 수집{" "}
                  <span className={`font-semibold ${m.isToday ? "text-slate-800" : "text-amber-600"}`}>
                    {shortDate(m.latestDate)}
                    {!m.isToday && m.latestDate ? " (오늘 아님)" : ""}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  {timeOf(m.firstAt)} ~ {timeOf(m.lastAt)}
                </div>
              </div>

              <div className="min-w-[170px]">
                <div className="text-xs text-slate-500 tabular-nums">
                  수집 <span className="font-semibold text-slate-800">{fmt(m.collected)}</span> / {fmt(m.total)}
                  {m.stale > 0 && <span className="ml-1.5 font-semibold text-amber-600">빠짐 {fmt(m.stale)}</span>}
                </div>
                <div className="mt-1 h-1.5 w-40 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
                </div>
              </div>

              <div className="min-w-[170px] text-xs">
                {!m.failures.available ? (
                  <span className="text-slate-400">실패 기록 테이블 없음</span>
                ) : m.failures.keywords === 0 ? (
                  <span className="text-slate-500">
                    <span aria-hidden>✓</span> 실패 없음
                  </span>
                ) : (
                  <button onClick={() => setOpen(isOpen ? null : m.mode)} className="text-left hover:underline">
                    <span className="font-semibold text-red-500">
                      <span aria-hidden>⚠</span> 실패 {fmt(m.failures.keywords)}건
                    </span>
                    <span className="block text-[11px] text-slate-400">
                      {kinds.map(([k, n]) => `${KIND_LABEL[k] ?? k} ${n}`).join(" · ")} {isOpen ? "▲" : "▼"}
                    </span>
                  </button>
                )}
              </div>

              <div className="ml-auto">
                <CoverageBars coverage={m.coverage} accent={accent} />
              </div>
            </div>

            {isOpen && m.failures.items.length > 0 && (
              <ul className="px-5 pb-3 space-y-1 max-h-64 overflow-y-auto">
                {m.failures.items.map((f, i) => (
                  <li key={i} className="text-xs text-slate-500 flex flex-wrap gap-x-2">
                    <span className="font-medium text-slate-700">{f.keyword}</span>
                    <span className="text-slate-400">{f.clientName}</span>
                    <span className="text-red-400">{f.kindLabel}</span>
                    {f.detail && <span className="text-slate-400 truncate max-w-md">{f.detail}</span>}
                    <span className="text-slate-300 tabular-nums">{timeOf(f.occurredAt)}</span>
                  </li>
                ))}
                {m.failures.keywords > m.failures.items.length && (
                  <li className="text-[11px] text-slate-400">외 {m.failures.keywords - m.failures.items.length}건</li>
                )}
              </ul>
            )}
          </div>
        );
      })}

      {data?.postStats && (
        <div className="px-5 py-3 border-t border-slate-50 text-xs text-slate-500 tabular-nums flex flex-wrap gap-x-4 gap-y-1">
          <span className="w-24 text-sm font-semibold text-slate-700">글 조회수</span>
          <span>
            최근 수집{" "}
            <span className={`font-semibold ${data.postStats.isToday ? "text-slate-800" : "text-amber-600"}`}>
              {shortDate(data.postStats.date)}
              {!data.postStats.isToday ? " (오늘 아님)" : ""}
            </span>
          </span>
          <span>관측 {fmt(data.postStats.observed)}글</span>
          <span>조회수 확인 {fmt(data.postStats.withViews)}</span>
          <span>회원 전용(비공개) {fmt(data.postStats.restricted)}</span>
          <span>삭제 확인 {fmt(data.postStats.deleted)}</span>
        </div>
      )}
    </section>
  );
}
