"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { KeywordHistory } from "@/lib/types";

interface RankHistoryProps {
  keywordId: string;
  keywordName: string;
  onClose: () => void;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

export default function RankHistory({
  keywordId,
  keywordName,
  onClose,
}: RankHistoryProps) {
  const [history, setHistory] = useState<KeywordHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/keywords/history?keywordId=${keywordId}`
        );
        if (res.ok) {
          const data = await res.json();
          setHistory(data);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [keywordId]);

  // 최근 30일 날짜 배열 생성
  const days: { date: string; label: string; dayName: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayName = DAY_NAMES[d.getDay()];
    days.push({
      date: dateStr,
      label: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      dayName,
    });
  }

  // 날짜별 순위 매핑
  const rankMap = new Map<string, number | null>();
  history.forEach((h) => {
    rankMap.set(h.tracked_date, h.rank);
  });

  const getRankColor = (rank: number | null) => {
    if (rank === null) return "bg-slate-50 text-slate-300";
    if (rank <= 3) return "bg-amber-50 text-amber-700 font-bold";
    if (rank <= 5) return "bg-emerald-50 text-emerald-700 font-bold";
    if (rank <= 10) return "bg-blue-50 text-blue-600 font-semibold";
    if (rank <= 20) return "bg-slate-100 text-slate-600";
    return "bg-slate-50 text-slate-500";
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              순위 변화 추이
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              키워드: <span className="font-medium text-slate-700">{keywordName}</span> · 최근 30일
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">불러오는 중...</div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, index) => {
              const rank = rankMap.get(day.date);
              const hasData = rankMap.has(day.date);

              return (
                <motion.div
                  key={day.date}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.015 }}
                  className={`rounded-xl p-3 text-center transition-all ${getRankColor(hasData ? rank ?? null : null)}`}
                >
                  <div className="text-[10px] text-slate-400 mb-1">
                    {day.label}({day.dayName})
                  </div>
                  <div className="text-lg leading-tight">
                    {hasData ? (
                      rank !== null ? (
                        <span>{rank}위</span>
                      ) : (
                        <span className="text-xs text-red-300">순위권 외</span>
                      )
                    ) : (
                      <span className="text-xs text-slate-200">-</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {!loading && history.length === 0 && (
          <p className="text-center text-slate-400 text-sm mt-4">
            아직 기록된 순위 데이터가 없습니다. 순위를 새로고침하면 기록이 시작됩니다.
          </p>
        )}
      </motion.div>
    </div>
  );
}
