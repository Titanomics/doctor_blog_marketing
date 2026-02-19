"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Client, Keyword } from "@/lib/types";
import RankBadge from "@/components/dashboard/RankBadge";
import RankChange from "@/components/dashboard/RankChange";
import RankHistory from "@/components/dashboard/RankHistory";

interface MainPanelProps {
  client: Client | null;
  onClientUpdated: () => void;
}

export default function MainPanel({ client, onClientUpdated }: MainPanelProps) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [deletingClient, setDeletingClient] = useState(false);
  const [historyKeyword, setHistoryKeyword] = useState<{ id: string; name: string } | null>(null);

  const fetchKeywords = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/keywords?clientId=${client.id}`);
      if (res.ok) {
        const data = await res.json();
        setKeywords(data);
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    setKeywords([]);
    setBatchMessage("");
    fetchKeywords();
  }, [fetchKeywords]);

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !newKeyword.trim()) return;
    setAddingKeyword(true);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: client.id,
          keyword: newKeyword.trim(),
        }),
      });
      if (res.ok) {
        setNewKeyword("");
        fetchKeywords();
      }
    } finally {
      setAddingKeyword(false);
    }
  };

  const handleRefreshKeyword = async (kw: Keyword) => {
    if (!client) return;
    setRefreshingId(kw.id);
    try {
      const res = await fetch(
        `/api/search?keyword=${encodeURIComponent(kw.keyword)}&blogUrl=${encodeURIComponent(client.blog_url)}`
      );
      if (!res.ok) return;
      const data = await res.json();

      await fetch("/api/keywords", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: kw.id,
          previous_rank: kw.current_rank,
          current_rank: data.foundRank,
          matched_title: data.found?.title ?? null,
          matched_url: data.found?.link ?? null,
          updated_at: new Date().toISOString(),
        }),
      });

      fetchKeywords();
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDeleteKeyword = async (id: string) => {
    await fetch(`/api/keywords?id=${id}`, { method: "DELETE" });
    fetchKeywords();
  };

  const handleBatchRefresh = async () => {
    setBatchLoading(true);
    setBatchMessage("");
    try {
      const res = await fetch("/api/batch-track", { method: "POST" });
      const data = await res.json();
      setBatchMessage(data.message ?? "완료");
      fetchKeywords();
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!client) return;
    if (!confirm(`"${client.name}" 병원을 삭제하시겠습니까?\n관련 키워드도 모두 삭제됩니다.`)) return;
    setDeletingClient(true);
    try {
      await fetch(`/api/clients?id=${client.id}`, { method: "DELETE" });
      onClientUpdated();
    } finally {
      setDeletingClient(false);
    }
  };

  const isDroppedFromTop7 = (kw: Keyword) =>
    kw.previous_rank !== null &&
    kw.previous_rank <= 7 &&
    (kw.current_rank === null || kw.current_rank > 7);

  if (!client) {
    return (
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-400 text-base md:text-lg">
            <span className="hidden md:inline">좌측에서 병원을 선택하세요</span>
            <span className="md:hidden">메뉴에서 병원을 선택하세요</span>
          </p>
          <p className="text-slate-300 text-sm mt-2">
            선택한 병원의 키워드 순위가 표시됩니다
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-16 md:pt-8">
      {/* 병원 헤더 */}
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">{client.name}</h2>
          <div className="flex flex-wrap items-center gap-2 md:gap-4 mt-1">
            <span className="text-sm text-slate-500">
              담당: {client.assignee}
            </span>
            <a
              href={`https://${client.blog_url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-emerald-600 hover:underline break-all"
            >
              {client.blog_url}
            </a>
            <button
              onClick={handleDeleteClient}
              disabled={deletingClient}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              병원 삭제
            </button>
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleBatchRefresh}
          disabled={batchLoading}
          className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2 self-start shrink-0"
        >
          {batchLoading ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              전체 갱신 중...
            </>
          ) : (
            "전체 순위 새로고침"
          )}
        </motion.button>
      </div>

      <AnimatePresence>
        {batchMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-emerald-50 text-emerald-700 text-sm px-4 py-3 rounded-xl mb-4"
          >
            {batchMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PC: 테이블 / 모바일: 카드 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* PC 테이블 (md 이상) */}
        <table className="w-full hidden md:table">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-48">
                키워드
              </th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">
                현재 순위
              </th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">
                변화
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                매칭 포스트
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-36">
                마지막 갱신
              </th>
              <th className="px-5 py-3.5 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400">
                  불러오는 중...
                </td>
              </tr>
            ) : keywords.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-400">
                  등록된 키워드가 없습니다
                </td>
              </tr>
            ) : (
              keywords.map((kw, index) => (
                <motion.tr
                  key={kw.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-5 py-4 font-medium text-slate-800">
                    <button
                      onClick={() => setHistoryKeyword({ id: kw.id, name: kw.keyword })}
                      className={`transition-colors cursor-pointer text-left ${isDroppedFromTop7(kw) ? "text-red-500 hover:text-red-600" : "hover:text-emerald-600"}`}
                      title="순위 변화 보기"
                    >
                      {kw.keyword}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <RankBadge rank={kw.current_rank} />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <RankChange
                      current={kw.current_rank}
                      previous={kw.previous_rank}
                    />
                  </td>
                  <td className="px-5 py-4">
                    {kw.matched_url ? (
                      <a
                        href={kw.matched_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-600 hover:underline truncate block max-w-xs"
                      >
                        {kw.matched_title ?? kw.matched_url}
                      </a>
                    ) : (
                      <span className="text-sm text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs text-slate-400">
                    {kw.updated_at
                      ? new Date(kw.updated_at).toLocaleDateString("ko-KR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRefreshKeyword(kw)}
                        disabled={refreshingId === kw.id}
                        title="순위 새로고침"
                        className="text-slate-400 hover:text-emerald-500 transition-colors"
                      >
                        <svg
                          className={`w-4 h-4 ${refreshingId === kw.id ? "animate-spin" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteKeyword(kw.id)}
                        title="키워드 삭제"
                        className="text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>

        {/* 모바일 카드 (md 미만) */}
        <div className="md:hidden">
          {loading ? (
            <div className="text-center py-12 text-slate-400">불러오는 중...</div>
          ) : keywords.length === 0 ? (
            <div className="text-center py-12 text-slate-400">등록된 키워드가 없습니다</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {keywords.map((kw, index) => (
                <motion.div
                  key={kw.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <button
                      onClick={() => setHistoryKeyword({ id: kw.id, name: kw.keyword })}
                      className={`font-medium transition-colors text-left ${isDroppedFromTop7(kw) ? "text-red-500 hover:text-red-600" : "text-slate-800 hover:text-emerald-600"}`}
                    >
                      {kw.keyword}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRefreshKeyword(kw)}
                        disabled={refreshingId === kw.id}
                        className="text-slate-400 hover:text-emerald-500 transition-colors p-1"
                      >
                        <svg
                          className={`w-4 h-4 ${refreshingId === kw.id ? "animate-spin" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteKeyword(kw.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <RankBadge rank={kw.current_rank} />
                    <RankChange current={kw.current_rank} previous={kw.previous_rank} />
                  </div>
                  {kw.matched_url && (
                    <a
                      href={kw.matched_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-600 hover:underline truncate block mb-1"
                    >
                      {kw.matched_title ?? kw.matched_url}
                    </a>
                  )}
                  <p className="text-xs text-slate-400">
                    {kw.updated_at
                      ? new Date(kw.updated_at).toLocaleDateString("ko-KR", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* 키워드 추가 폼 */}
        <form
          onSubmit={handleAddKeyword}
          className="flex items-center gap-3 px-4 md:px-5 py-4 border-t border-slate-100 bg-slate-50/50"
        >
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="새 키워드 입력"
            className="flex-1 px-3 md:px-4 py-2 text-sm rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none text-slate-800 placeholder:text-slate-400"
          />
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="submit"
            disabled={addingKeyword || !newKeyword.trim()}
            className="px-4 md:px-5 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors shrink-0"
          >
            {addingKeyword ? "..." : "추가"}
          </motion.button>
        </form>
      </div>
      <AnimatePresence>
        {historyKeyword && (
          <RankHistory
            keywordId={historyKeyword.id}
            keywordName={historyKeyword.name}
            onClose={() => setHistoryKeyword(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
