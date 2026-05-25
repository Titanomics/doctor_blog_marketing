"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type CafeBreakdown = {
  name: string;
  count: number;
  source: "user" | "unclassified";
};

type MonthStat = {
  month: string;
  label: string;
  total: number;
  cafes: CafeBreakdown[];
};

interface CafeStatsPanelProps {
  clientId: string;
  clientName: string;
}

export default function CafeStatsPanel({ clientId, clientName }: CafeStatsPanelProps) {
  const [months, setMonths] = useState<MonthStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(2); // 가장 최근 월 기본

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/cafe/stats?clientId=${clientId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setMonths(d.months ?? []);
        setSelectedIdx((d.months?.length ?? 1) - 1);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const selected = months[selectedIdx];
  const maxCount = selected ? Math.max(1, ...selected.cafes.map((c) => c.count)) : 1;

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-16 md:pt-8">
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-slate-800">📊 카페 발행 통계</h2>
        <p className="text-sm text-slate-500 mt-1">
          브랜드: {clientName} · 최근 3개월 키워드 등록 기준
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-400">
          불러오는 중...
        </div>
      ) : months.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-400">
          데이터가 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {/* 월 탭 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="flex">
              {months.map((m, i) => (
                <button
                  key={m.month}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex-1 px-5 py-4 text-sm font-semibold transition-colors border-b-2 ${
                    i === selectedIdx
                      ? "border-violet-500 text-violet-700 bg-violet-50/50"
                      : "border-transparent text-slate-500 hover:text-violet-600 hover:bg-slate-50"
                  }`}
                >
                  <div>{m.label}</div>
                  <div className="text-xs font-normal mt-0.5 opacity-70">{m.total}건</div>
                </button>
              ))}
            </div>
          </div>

          {/* 선택된 월의 카페별 breakdown */}
          {selected && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  {selected.label} 카페별 발행 건수
                </span>
                <span className="text-xs text-slate-500">총 {selected.total}건</span>
              </div>
              {selected.cafes.length === 0 ? (
                <div className="px-5 py-8 text-center text-slate-400 text-sm">
                  이 달에는 발행이 없습니다
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {selected.cafes.map((c, i) => (
                    <motion.div
                      key={c.name}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="px-5 py-3 flex items-center gap-4"
                    >
                      <div className="w-40 md:w-56 shrink-0">
                        <span className="text-sm font-medium text-slate-800">{c.name}</span>
                        {c.source === "unclassified" && (
                          <span className="ml-1.5 text-xs text-red-400">(미분류)</span>
                        )}
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-violet-400 h-full transition-all"
                          style={{ width: `${(c.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <div className="w-12 text-right text-sm font-semibold text-slate-700 shrink-0">
                        {c.count}건
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
