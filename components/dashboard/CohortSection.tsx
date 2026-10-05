"use client";

import { useEffect, useState } from "react";

// 발행 묶음(발행 주)별 현황 표.
// 글이 며칠에 몰아서 발행되는 경우가 많아, "발행 몇 주차"만 보면 묶음의 차이와 섞인다.
// 그래서 발행 주별로 지금 몇 개가 떠 있는지를 나란히 본다. 고유 글 기준.

interface Cohort {
  weekStart: string | null;
  week: number | null;
  posts: number;
  exposed: number;
  unexposed: number;
  deleted: number;
  lateFirst: number;
}

interface CohortResponse {
  today: string;
  brands: string[];
  cafe: Record<string, Cohort[]>;
  reporter: Record<string, Cohort[]>;
}

const DEFAULT_BRAND = "솔커트";

function shortDate(date: string) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 노출·미노출·삭제 비율 막대 (한 줄의 합 = 그 묶음의 글 수)
function Bar({ c }: { c: Cohort }) {
  const total = Math.max(1, c.posts);
  const seg = (n: number, color: string, label: string) =>
    n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: color }} title={`${label} ${n}글`} /> : null;
  return (
    <div className="flex h-2 w-36 rounded-full overflow-hidden bg-slate-100 gap-px">
      {seg(c.exposed, "#8b5cf6", "노출")}
      {seg(c.unexposed, "#cbd5e1", "미노출")}
      {seg(c.deleted, "#fca5a5", "삭제")}
    </div>
  );
}

export default function CohortSection() {
  const [data, setData] = useState<CohortResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<"cafe" | "reporter">("cafe");
  const [brand, setBrand] = useState<string>(DEFAULT_BRAND);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/age/cohorts", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: CohortResponse) => {
        if (cancelled) return;
        setData(d);
        if (!d.brands.includes(DEFAULT_BRAND)) setBrand("전체");
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data ? data[kind][brand] ?? [] : [];
  const chip = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
      active ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
    }`;

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-slate-800">발행 묶음별 현황</h2>
        <span className="text-[11px] text-slate-400">
          발행한 주별로 지금 떠 있는 글 수 · 고유 글 기준(같은 글이 여러 키워드에 등록돼도 한 번) · 발행일을 모르는 글은 따로 표시
        </span>
      </div>

      <div className="px-5 py-3 flex flex-wrap items-center gap-1.5">
        <button className={chip(kind === "cafe")} onClick={() => setKind("cafe")}>
          카페
        </button>
        <button className={chip(kind === "reporter")} onClick={() => setKind("reporter")}>
          블로그기자단
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {["전체", ...(data?.brands ?? [])].map((b) => (
          <button key={b} className={chip(brand === b)} onClick={() => setBrand(b)}>
            {b}
          </button>
        ))}
      </div>

      {failed && <div className="px-5 pb-5 text-sm text-slate-400">불러오지 못했습니다.</div>}
      {!data && !failed && <div className="px-5 pb-5 text-sm text-slate-400">불러오는 중...</div>}
      {data && rows.length === 0 && <div className="px-5 pb-5 text-sm text-slate-400">등록된 글이 없습니다.</div>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <th className="px-5 py-2.5 text-left font-semibold">발행 주</th>
                <th className="px-3 py-2.5 text-right font-semibold">지금</th>
                <th className="px-3 py-2.5 text-right font-semibold">글</th>
                <th className="px-3 py-2.5 text-right font-semibold">노출</th>
                <th className="px-3 py-2.5 text-right font-semibold">미노출</th>
                <th className="px-3 py-2.5 text-right font-semibold">삭제</th>
                <th className="px-3 py-2.5 text-left font-semibold">비율</th>
                <th className="px-5 py-2.5 text-right font-semibold">2주차 이후 처음 노출</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((c) => (
                <tr key={c.weekStart ?? "unknown"} className="border-t border-slate-50">
                  <td className="px-5 py-2.5 text-slate-700 whitespace-nowrap">
                    {c.weekStart ? `${shortDate(c.weekStart)} 주` : <span className="text-slate-400">발행일 미상</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500 whitespace-nowrap">{c.week ? `${c.week}주차` : "-"}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{c.posts}</td>
                  <td className={`px-3 py-2.5 text-right ${c.exposed ? "font-semibold text-violet-600" : "text-slate-300"}`}>{c.exposed || "-"}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{c.unexposed || "-"}</td>
                  <td className={`px-3 py-2.5 text-right ${c.deleted ? "text-red-400" : "text-slate-300"}`}>{c.deleted || "-"}</td>
                  <td className="px-3 py-2.5">
                    <Bar c={c} />
                  </td>
                  <td className={`px-5 py-2.5 text-right ${c.lateFirst ? "font-semibold text-violet-600" : "text-slate-300"}`}>{c.lateFirst || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-2.5 border-t border-slate-50 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: "#8b5cf6" }} /> 노출</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: "#cbd5e1" }} /> 미노출</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: "#fca5a5" }} /> 삭제</span>
        <span>“2주차 이후 처음 노출”은 수집 기록이 있는 기간만 셉니다 (카페는 2026-10-05부터)</span>
      </div>
    </section>
  );
}
