"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CafeClient, ReporterKeyword, ReporterBlogEntry } from "@/lib/types";
import RankBadge from "@/components/dashboard/RankBadge";
import RankChange from "@/components/dashboard/RankChange";

interface ReporterPanelProps {
  client: CafeClient | null;
  onClientUpdated: () => void;
}

const RefreshIcon = ({ spinning }: { spinning?: boolean }) => (
  <svg className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const DeleteIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    fill="none" stroke="currentColor" viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const PencilIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" />
  </svg>
);

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const COOLDOWN_MS = 60 * 60 * 1000;

function isCooldown(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < COOLDOWN_MS;
}

function cooldownRemaining(updatedAt: string | null): string {
  if (!updatedAt) return "";
  const diff = COOLDOWN_MS - (Date.now() - new Date(updatedAt).getTime());
  if (diff <= 0) return "";
  const min = Math.ceil(diff / 60000);
  return `${min}분 후 새로고침 가능`;
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export default function ReporterPanel({ client, onClientUpdated }: ReporterPanelProps) {
  const [keywords, setKeywords] = useState<ReporterKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [deletingClient, setDeletingClient] = useState(false);

  // 키워드 추가
  const [newKeyword, setNewKeyword] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);

  // URL 추가 (키워드별)
  const [addingUrlFor, setAddingUrlFor] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState("");

  // 새로고침
  const [refreshingEntryId, setRefreshingEntryId] = useState<string | null>(null);

  // 키워드 열기/닫기
  const [openKeywords, setOpenKeywords] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const toggleKeyword = (id: string) => {
    setOpenKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 키워드 편집
  const [editingKeywordId, setEditingKeywordId] = useState<string | null>(null);
  const [editingKeywordText, setEditingKeywordText] = useState("");

  const fetchKeywords = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reporter/keywords?clientId=${client.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setKeywords(data);
        // 첫 로드 시 첫 번째 키워드 자동 열기
        if (!initializedRef.current && data.length > 0) {
          setOpenKeywords(new Set([data[0].id]));
          initializedRef.current = true;
        }
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    setKeywords([]);
    setBatchMessage("");
    setOpenKeywords(new Set());
    initializedRef.current = false;
    fetchKeywords();
  }, [fetchKeywords]);

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !newKeyword.trim()) return;
    setAddingKeyword(true);
    try {
      const res = await fetch("/api/reporter/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id, keyword: newKeyword.trim() }),
      });
      if (res.ok) {
        setNewKeyword("");
        fetchKeywords();
      }
    } finally {
      setAddingKeyword(false);
    }
  };

  const handleDeleteKeyword = async (id: string) => {
    await fetch(`/api/reporter/keywords?id=${id}`, { method: "DELETE" });
    fetchKeywords();
  };

  const handleSaveKeywordEdit = async (id: string) => {
    const text = editingKeywordText.trim();
    if (!text) return;
    setEditingKeywordId(null);
    await fetch("/api/reporter/keywords", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, keyword: text }),
    });
    fetchKeywords();
  };

  const handleAddUrl = async (keywordId: string) => {
    if (!newUrl.trim()) return;
    setUrlError("");
    setAddingUrl(true);
    try {
      const res = await fetch("/api/reporter/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: keywordId, blog_url: newUrl.trim() }),
      });
      if (res.ok) {
        setNewUrl("");
        setAddingUrlFor(null);
        fetchKeywords();
      } else {
        const data = await res.json();
        setUrlError(data.error ?? "오류가 발생했습니다.");
      }
    } finally {
      setAddingUrl(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    await fetch(`/api/reporter/entries?id=${id}`, { method: "DELETE" });
    fetchKeywords();
  };

  const handleRefreshEntry = async (entry: ReporterBlogEntry, keyword: string) => {
    setRefreshingEntryId(entry.id);
    try {
      const params = new URLSearchParams({ keyword, blogUrl: entry.blog_url });
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();

      await fetch("/api/reporter/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          previous_rank: entry.current_rank,
          current_rank: data.foundRank ?? null,
          matched_title: data.found?.title ?? data.foundInSmartBlock?.title ?? null,
          matched_url: data.found?.link ?? data.foundInSmartBlock?.link ?? null,
          smart_block_name: data.foundInSmartBlock?.blockName ?? null,
          smart_block_rank: data.foundInSmartBlock?.rank ?? null,
          updated_at: new Date().toISOString(),
        }),
      });

      fetchKeywords();
    } finally {
      setRefreshingEntryId(null);
    }
  };

  const batchCooldown = keywords.some((kw) =>
    kw.entries?.some((e) => isCooldown(e.updated_at))
  );
  const batchCooldownLabel = (() => {
    if (!batchCooldown) return "";
    let latest = 0;
    for (const kw of keywords) {
      for (const e of kw.entries ?? []) {
        const t = e.updated_at ? new Date(e.updated_at).getTime() : 0;
        if (t > latest) latest = t;
      }
    }
    if (!latest) return "";
    const diff = COOLDOWN_MS - (Date.now() - latest);
    return diff > 0 ? `${Math.ceil(diff / 60000)}분 후 가능` : "";
  })();

  const handleBatchRefresh = async () => {
    if (batchCooldown) return;
    setBatchLoading(true);
    setBatchMessage("");
    try {
      const res = await fetch(`/api/reporter/batch-track?clientId=${client!.id}`, { method: "POST" });
      const data = await res.json();
      setBatchMessage(data.message ?? "완료");
      fetchKeywords();
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!client) return;
    if (!confirm(`"${client.name}" 브랜드를 삭제하시겠습니까?\n관련 키워드도 모두 삭제됩니다.`)) return;
    setDeletingClient(true);
    try {
      await fetch(`/api/cafe/clients?id=${client.id}`, { method: "DELETE" });
      onClientUpdated();
    } finally {
      setDeletingClient(false);
    }
  };

  if (!client) {
    return (
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-400 text-base md:text-lg">
            <span className="hidden md:inline">좌측에서 브랜드를 선택하세요</span>
            <span className="md:hidden">메뉴에서 브랜드를 선택하세요</span>
          </p>
          <p className="text-slate-300 text-sm mt-2">선택한 브랜드의 블로그기자단 순위가 표시됩니다</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-16 md:pt-8">
      {/* 헤더 */}
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">{client.name}</h2>
          <div className="flex items-center gap-4 mt-1">
            {client.assignee && <span className="text-sm text-slate-500">담당: {client.assignee}</span>}
            <button onClick={handleDeleteClient} disabled={deletingClient} className="text-xs text-red-400 hover:text-red-600 transition-colors">
              브랜드 삭제
            </button>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleBatchRefresh}
          disabled={batchLoading || batchCooldown}
          title={batchCooldown ? batchCooldownLabel : ""}
          className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2 self-start shrink-0"
        >
          {batchLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              전체 갱신 중...
            </>
          ) : batchCooldown ? (
            batchCooldownLabel
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
            className="text-sm px-4 py-3 rounded-xl mb-4 bg-emerald-50 text-emerald-700"
          >
            {batchMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="text-center py-12 text-slate-400">불러오는 중...</div>
      ) : (
        <div className="space-y-4">
          {keywords.length === 0 && (
            <div className="text-center py-12 text-slate-400">등록된 키워드가 없습니다</div>
          )}

          {keywords.map((kw, kwIndex) => {
            const entries = kw.entries ?? [];
            const isOpen = openKeywords.has(kw.id);
            return (
              <motion.div
                key={kw.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: kwIndex * 0.04 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
              >
                {/* 키워드 헤더 (클릭 시 열기/닫기) */}
                <div
                  className="px-5 py-3.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between cursor-pointer select-none"
                  onClick={() => toggleKeyword(kw.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ChevronIcon open={isOpen} />
                    {editingKeywordId === kw.id ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          autoFocus
                          value={editingKeywordText}
                          onChange={(e) => setEditingKeywordText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveKeywordEdit(kw.id);
                            if (e.key === "Escape") setEditingKeywordId(null);
                          }}
                          className="px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-800 w-36"
                        />
                        <button onClick={() => handleSaveKeywordEdit(kw.id)} className="text-green-500 font-bold text-sm">✓</button>
                        <button onClick={() => setEditingKeywordId(null)} className="text-slate-400 text-sm">✕</button>
                      </div>
                    ) : (
                      <span className="text-sm font-semibold text-emerald-800 truncate">{kw.keyword}</span>
                    )}
                    <span className="text-xs text-emerald-500 shrink-0">{entries.length}/10</span>
                  </div>
                  <div
                    className="flex items-center gap-1.5 shrink-0 ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => { setEditingKeywordId(kw.id); setEditingKeywordText(kw.keyword); }}
                      className="text-emerald-400 hover:text-emerald-600 transition-colors p-1"
                      title="키워드 수정"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      onClick={() => handleDeleteKeyword(kw.id)}
                      className="text-emerald-400 hover:text-red-500 transition-colors p-1"
                      title="키워드 삭제"
                    >
                      <DeleteIcon />
                    </button>
                  </div>
                </div>

                {/* 아코디언 본문 */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      style={{ overflow: "hidden" }}
                    >
                      {/* 블로그 URL 목록 (최대 5개 높이 스크롤) */}
                      {entries.length > 0 && (
                        <div className="divide-y divide-slate-50 max-h-[280px] overflow-y-auto">
                          {entries.map((entry) => (
                            <div key={entry.id} className="px-4 md:px-5 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-500 truncate font-mono">{shortUrl(entry.blog_url)}</p>
                                {entry.matched_title && (
                                  <a
                                    href={entry.matched_url ?? entry.blog_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-emerald-600 hover:underline truncate block mt-0.5"
                                  >
                                    {entry.matched_title}
                                  </a>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <RankBadge
                                  rank={entry.current_rank}
                                  smartBlockName={entry.smart_block_name}
                                  smartBlockRank={entry.smart_block_rank}
                                  noRankLabel="미노출"
                                />
                                <RankChange current={entry.current_rank} previous={entry.previous_rank} />
                                <span className="text-xs text-slate-300 hidden md:block w-20 text-right">{formatDate(entry.updated_at)}</span>
                                <button
                                  onClick={() => handleRefreshEntry(entry, kw.keyword)}
                                  disabled={refreshingEntryId === entry.id || isCooldown(entry.updated_at)}
                                  className={`text-slate-400 ${isCooldown(entry.updated_at) ? "opacity-30 cursor-not-allowed" : "hover:text-emerald-500"} transition-colors p-1`}
                                  title={isCooldown(entry.updated_at) ? cooldownRemaining(entry.updated_at) : "순위 새로고침"}
                                >
                                  <RefreshIcon spinning={refreshingEntryId === entry.id} />
                                </button>
                                <button
                                  onClick={() => handleDeleteEntry(entry.id)}
                                  className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                  title="URL 삭제"
                                >
                                  <DeleteIcon />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* URL 추가 영역 */}
                      <div className="px-4 md:px-5 py-3 border-t border-slate-50 bg-slate-50/30">
                        {addingUrlFor === kw.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              type="text"
                              value={newUrl}
                              onChange={(e) => { setNewUrl(e.target.value); setUrlError(""); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddUrl(kw.id);
                                if (e.key === "Escape") { setAddingUrlFor(null); setNewUrl(""); setUrlError(""); }
                              }}
                              placeholder="blog.naver.com/username/postId"
                              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none text-slate-800"
                            />
                            <button
                              onClick={() => handleAddUrl(kw.id)}
                              disabled={addingUrl || !newUrl.trim()}
                              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-xs rounded-lg transition-colors shrink-0"
                            >
                              {addingUrl ? "..." : "추가"}
                            </button>
                            <button
                              onClick={() => { setAddingUrlFor(null); setNewUrl(""); setUrlError(""); }}
                              className="text-slate-400 hover:text-slate-600 text-xs"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAddingUrlFor(kw.id); setNewUrl(""); setUrlError(""); }}
                            disabled={entries.length >= 10}
                            className="text-xs text-emerald-500 hover:text-emerald-700 disabled:text-slate-300 transition-colors font-medium"
                          >
                            + URL 추가 {entries.length >= 10 ? "(최대 10개)" : ""}
                          </button>
                        )}
                        {urlError && addingUrlFor === kw.id && (
                          <p className="text-red-500 text-xs mt-1">{urlError}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {/* 키워드 추가 폼 */}
          <form onSubmit={handleAddKeyword} className="flex items-center gap-3">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="새 키워드 입력"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none text-slate-800 placeholder:text-slate-400 bg-white shadow-sm"
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={addingKeyword || !newKeyword.trim()}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors shrink-0"
            >
              {addingKeyword ? "..." : "+ 키워드 추가"}
            </motion.button>
          </form>
        </div>
      )}
    </main>
  );
}
