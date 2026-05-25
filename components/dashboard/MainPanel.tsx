"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Client, CafeClient, Keyword, CafeKeyword } from "@/lib/types";
import RankBadge from "@/components/dashboard/RankBadge";
import RankChange from "@/components/dashboard/RankChange";
import RankHistory from "@/components/dashboard/RankHistory";
import CafeStatsPanel from "@/components/dashboard/CafeStatsPanel";

type AnyClient = Client | CafeClient;
type AnyKeyword = Keyword | CafeKeyword;

interface MainPanelProps {
  mode: "blog" | "cafe";
  client: AnyClient | null;
  onClientUpdated: () => void;
}

const RefreshIcon = ({ spinning }: { spinning?: boolean }) => (
  <svg className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const DeleteIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

const COOLDOWN_MS = 5 * 60 * 1000; // 5분 (개별 새로고침 자주 가능)

function isCooldown(updatedAt: string | null, createdAt?: string | null): boolean {
  if (!updatedAt) return false;
  // 등록 직후(updated_at이 created_at과 5초 이내)는 쿨다운 아님 - 아직 한 번도 갱신 안 됨
  if (createdAt) {
    const diff = Math.abs(new Date(updatedAt).getTime() - new Date(createdAt).getTime());
    if (diff < 5000) return false;
  }
  return Date.now() - new Date(updatedAt).getTime() < COOLDOWN_MS;
}

function cooldownRemaining(updatedAt: string | null): string {
  if (!updatedAt) return "";
  const diff = COOLDOWN_MS - (Date.now() - new Date(updatedAt).getTime());
  if (diff <= 0) return "";
  const min = Math.ceil(diff / 60000);
  return `${min}분 후 새로고침 가능`;
}

function getCafeDisplay(kw: CafeKeyword): { name: string; source: "user" | "none" } {
  if (kw.cafe_name?.trim()) return { name: kw.cafe_name.trim(), source: "user" };
  return { name: "미분류", source: "none" };
}

function formatCreatedDate(dateStr: string) {
  const created = new Date(dateStr);
  const days = Math.floor((Date.now() - created.getTime()) / 86400000);
  const dateLabel = created.toISOString().split("T")[0];
  return { dateLabel, days };
}

export default function MainPanel({ mode, client, onClientUpdated }: MainPanelProps) {
  const [keywords, setKeywords] = useState<AnyKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newPostUrl, setNewPostUrl] = useState("");
  const [newPostTitle, setNewPostTitle] = useState("");
  const [newAuthorName, setNewAuthorName] = useState("");
  const [newCafeName, setNewCafeName] = useState("");
  const [activeView, setActiveView] = useState<"keywords" | "stats">("keywords");
  const [addError, setAddError] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [lastBatchTime, setLastBatchTime] = useState<number>(0);
  const [deletingClient, setDeletingClient] = useState(false);
  const [historyKeyword, setHistoryKeyword] = useState<{ id: string; name: string } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingPostUrl, setEditingPostUrl] = useState("");
  const [editingPostTitle, setEditingPostTitle] = useState("");
  const [editingAuthorName, setEditingAuthorName] = useState("");
  const [editingCafeName, setEditingCafeName] = useState("");
  const [editingCreatedAt, setEditingCreatedAt] = useState("");
  const [rankSort, setRankSort] = useState<"none" | "asc" | "desc">("none");
  const [prioritySort, setPrioritySort] = useState<"none" | "asc" | "desc">("none");
  const [keywordSort, setKeywordSort] = useState<"none" | "asc" | "desc">("none");
  const [updatedSort, setUpdatedSort] = useState<"none" | "asc" | "desc">("none");
  const [createdSort, setCreatedSort] = useState<"none" | "asc" | "desc">("none");

  const isBlog = mode === "blog";
  const apiBase = isBlog ? "" : "/cafe";
  const keywordsApi = `/api${apiBase}/keywords`;
  const searchApi = `/api${apiBase}/search`;
  const clientsApi = `/api${apiBase}/clients`;
  const historyApi = `/api${apiBase}/keywords/history`;
  const entityLabel = isBlog ? "병원" : "브랜드";
  const accentText = isBlog ? "text-emerald-600" : "text-violet-600";
  const accentHover = isBlog ? "hover:text-emerald-600" : "hover:text-violet-600";
  const accentBg = isBlog ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700";
  const accentBtn = isBlog ? "bg-emerald-500 hover:bg-emerald-600" : "bg-violet-500 hover:bg-violet-600";
  const accentFocus = isBlog
    ? "focus:border-emerald-500 focus:ring-emerald-500/20"
    : "focus:border-violet-500 focus:ring-violet-500/20";
  const accentRefresh = isBlog ? "hover:text-emerald-500" : "hover:text-violet-500";

  const fetchKeywords = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await fetch(`${keywordsApi}?clientId=${client.id}`, { cache: "no-store" });
      if (res.ok) setKeywords(await res.json());
    } finally {
      setLoading(false);
    }
  }, [client, keywordsApi]);

  useEffect(() => {
    setKeywords([]);
    setBatchMessage("");
    fetchKeywords();
  }, [fetchKeywords]);

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !newKeyword.trim()) return;
    setAddError("");

    if (!isBlog && !newPostUrl.trim() && !newPostTitle.trim()) {
      setAddError("포스팅 URL 또는 제목 중 하나는 입력해주세요.");
      return;
    }

    setAddingKeyword(true);
    try {
      const body: Record<string, string> = { client_id: client.id, keyword: newKeyword.trim() };
      if (!isBlog) {
        if (newPostUrl.trim()) body.post_url = newPostUrl.trim();
        if (newPostTitle.trim()) body.post_title = newPostTitle.trim();
        if (newAuthorName.trim()) body.author_name = newAuthorName.trim();
        if (newCafeName.trim()) body.cafe_name = newCafeName.trim();
      }

      const res = await fetch(keywordsApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setNewKeyword("");
        setNewPostUrl("");
        setNewPostTitle("");
        setNewAuthorName("");
        setNewCafeName("");
        fetchKeywords();
      } else {
        const data = await res.json();
        setAddError(data.error ?? "오류가 발생했습니다.");
      }
    } finally {
      setAddingKeyword(false);
    }
  };

  const handleRefreshKeyword = async (kw: AnyKeyword) => {
    setRefreshingId(kw.id);
    try {
      const params = new URLSearchParams({ keyword: kw.keyword });

      if (isBlog) {
        params.set("blogUrl", (client as Client).blog_url);
      } else {
        const cafeKw = kw as CafeKeyword;
        if (cafeKw.post_url) params.set("postUrl", cafeKw.post_url);
        if (cafeKw.post_title) params.set("postTitle", cafeKw.post_title);
      }

      const res = await fetch(`${searchApi}?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();

      const isReply = !!data.foundInReply && !data.found && !data.foundInSmartBlock;
      const cafeKw = kw as CafeKeyword;
      // 꼬리글 진입 시 시각 기록, 빠져나오면 null 리셋, 유지 중에는 보존
      let replySince = cafeKw.reply_since ?? null;
      if (isReply && !cafeKw.is_reply) {
        replySince = new Date().toISOString();
      } else if (!isReply) {
        replySince = null;
      }

      // 삭제 표시 유지 조건 (cafe/batch-track과 동일):
      // - 'deleted' 명시 확인 → 표시
      // - 'alive' 명시 확인 → 명시적 갱신
      // - 'unknown' / 검사 안함 + 매칭 실패 + 기존 표시 → 보존 (수동 토글/일시 API 장애 흡수)
      const postStatus: "deleted" | "alive" | "unknown" | null = data.postStatus ?? null;
      const wasMarkedDeleted = !isBlog && kw.matched_title === "[삭제된 게시글]";
      const noMatchFound = !data.found && !data.foundInSmartBlock && !data.foundInReply;
      const keepDeletedMark =
        !isBlog &&
        (postStatus === "deleted" ||
          (postStatus !== "alive" && noMatchFound && wasMarkedDeleted));

      const patchBody: Record<string, unknown> = {
        id: kw.id,
        previous_rank: kw.current_rank,
        current_rank: data.foundRank ?? null,
        matched_title: keepDeletedMark
          ? "[삭제된 게시글]"
          : (data.found?.title ?? data.foundInSmartBlock?.title ?? null),
        matched_url: data.found?.link ?? data.foundInSmartBlock?.link ?? null,
        smart_block_name: data.foundInSmartBlock?.blockName ?? null,
        smart_block_rank: data.foundInSmartBlock?.rank ?? null,
        updated_at: new Date().toISOString(),
      };
      if (!isBlog) {
        patchBody.is_reply = isReply;
        patchBody.reply_since = replySince;
      }

      await fetch(keywordsApi, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });

      fetchKeywords();
    } finally {
      setRefreshingId(null);
    }
  };

  const handleSaveEdit = async (id: string) => {
    const text = editingText.trim();
    if (!text) return;
    setEditingId(null);
    const body: Record<string, string | null> = { id, keyword: text };
    if (!isBlog) {
      body.post_url = editingPostUrl.trim() || null;
      body.post_title = editingPostTitle.trim() || null;
      body.author_name = editingAuthorName.trim() || null;
      body.cafe_name = editingCafeName.trim() || null;
      if (editingCreatedAt) {
        // YYYY-MM-DD → KST 자정 ISO (UTC)
        body.created_at = new Date(`${editingCreatedAt}T00:00:00+09:00`).toISOString();
      }
    }
    await fetch(keywordsApi, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetchKeywords();
  };

  const handlePriorityChange = async (id: string, priority: number) => {
    setKeywords(prev => prev.map(kw => kw.id === id ? { ...kw, priority } : kw));
    await fetch(keywordsApi, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, priority }),
    });
  };

  const handleDeleteKeyword = async (id: string) => {
    await fetch(`${keywordsApi}?id=${id}`, { method: "DELETE" });
    fetchKeywords();
  };

  const handleToggleDeleted = async (kw: AnyKeyword) => {
    const isDeleted = kw.matched_title === "[삭제된 게시글]";
    const newTitle = isDeleted ? null : "[삭제된 게시글]";
    await fetch(keywordsApi, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: kw.id,
        matched_title: newTitle,
        ...(isDeleted ? {} : { current_rank: null, smart_block_rank: null }),
      }),
    });
    fetchKeywords();
  };

  const batchCooldown = lastBatchTime > 0 && Date.now() - lastBatchTime < COOLDOWN_MS;
  const batchCooldownLabel = (() => {
    if (!batchCooldown) return "";
    const diff = COOLDOWN_MS - (Date.now() - lastBatchTime);
    return diff > 0 ? `${Math.ceil(diff / 60000)}분 후 가능` : "";
  })();

  // 키워드 수가 임계 이상이면 서버 batch-track으로 위임 (브라우저 잠금 방지)
  const SERVER_DELEGATE_THRESHOLD = 20;
  // 서버측 KEYWORD_DELAY_MS와 일치 (예상 처리 시간 추정용)
  const KEYWORD_DELAY_MS_UI = 11_000;

  const handleBatchRefresh = async () => {
    if (!client || batchCooldown) return;
    setLastBatchTime(Date.now());
    setBatchLoading(true);
    setBatchMessage("");

    // 큰 client: 서버 위임 (chunk 체인 처리, 30~83분 소요 가능)
    if (keywords.length > SERVER_DELEGATE_THRESHOLD) {
      const batchEndpoint = isBlog ? "/api/batch-track" : "/api/cafe/batch-track";
      try {
        setBatchMessage(`서버에 갱신 요청 중 (${keywords.length}개)...`);
        const res = await fetch(`${batchEndpoint}?clientId=${client.id}`, { method: "POST" });
        if (!res.ok) {
          setBatchMessage(`서버 위임 실패: HTTP ${res.status}`);
          setBatchLoading(false);
          return;
        }
        const data = await res.json();
        const estMin = Math.ceil((keywords.length * KEYWORD_DELAY_MS_UI) / 60_000);
        setBatchMessage(`${data.message ?? "서버 갱신 시작"} — 약 ${estMin}분 소요. 30초마다 진행 확인 중...`);

        // 폴링: 30초마다 fetchKeywords 후 갱신 진행률 측정
        // 키워드의 updated_at이 위임 시작 시각 이후로 바뀐 비율 계산
        const startedAt = Date.now();
        const maxPollMs = (keywords.length * KEYWORD_DELAY_MS_UI) + 5 * 60_000; // 예상 + 5분 여유
        const pollIntervalMs = 30_000;
        const pollStart = startedAt;

        const poll = async () => {
          if (Date.now() - pollStart > maxPollMs) {
            setBatchMessage(`갱신 시간 초과 (${Math.ceil(maxPollMs / 60_000)}분). 화면 새로고침 후 직접 확인하세요.`);
            setBatchLoading(false);
            return;
          }
          try {
            const r = await fetch(`${keywordsApi}?clientId=${client.id}`, { cache: "no-store" });
            if (r.ok) {
              const fresh = (await r.json()) as AnyKeyword[];
              setKeywords(fresh);
              const updatedCount = fresh.filter((k) => k.updated_at && new Date(k.updated_at).getTime() >= startedAt).length;
              const pct = Math.floor((updatedCount / fresh.length) * 100);
              setBatchMessage(`갱신 진행 중: ${updatedCount}/${fresh.length} (${pct}%)`);
              if (updatedCount >= fresh.length) {
                setBatchMessage(`${fresh.length}개 갱신 완료`);
                setBatchLoading(false);
                return;
              }
            }
          } catch {
            // 폴링 에러는 조용히 다시 시도
          }
          setTimeout(poll, pollIntervalMs);
        };
        setTimeout(poll, pollIntervalMs);
      } catch (err) {
        setBatchMessage(`서버 위임 오류: ${err instanceof Error ? err.message : String(err)}`);
        setBatchLoading(false);
      }
      return;
    }

    // 작은 client: 기존 직렬 패턴 (UI 진행 표시 유리)
    let completed = 0;
    let failed = 0;
    try {
      for (const kw of keywords) {
        setBatchMessage(`${completed + failed + 1}/${keywords.length} 갱신 중...`);
        try {
          await handleRefreshKeyword(kw);
          completed++;
        } catch {
          failed++;
        }
      }
      setBatchMessage(`${completed}개 완료${failed > 0 ? `, ${failed}개 실패` : ""}`);
      fetchKeywords();
    } finally {
      setBatchLoading(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!client) return;
    if (!confirm(`"${client.name}" ${entityLabel}을 삭제하시겠습니까?\n관련 키워드도 모두 삭제됩니다.`)) return;
    setDeletingClient(true);
    try {
      await fetch(`${clientsApi}?id=${client.id}`, { method: "DELETE" });
      onClientUpdated();
    } finally {
      setDeletingClient(false);
    }
  };

  const handleExportExcel = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/cafe/export");
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().split("T")[0];
      a.download = `카페_상위노출_리포트_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportLoading(false);
    }
  };

  const isDroppedFromTop7 = (kw: AnyKeyword) =>
    kw.previous_rank !== null &&
    kw.previous_rank <= 7 &&
    (kw.current_rank === null || kw.current_rank > 7);

  if (!client) {
    return (
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-400 text-base md:text-lg">
            <span className="hidden md:inline">좌측에서 {entityLabel}을 선택하세요</span>
            <span className="md:hidden">메뉴에서 {entityLabel}을 선택하세요</span>
          </p>
          <p className="text-slate-300 text-sm mt-2">선택한 {entityLabel}의 키워드 순위가 표시됩니다</p>
        </div>
      </main>
    );
  }

  // 카페 모드 + 통계 view → 통계 패널 렌더
  if (!isBlog && activeView === "stats") {
    return <CafeStatsPanel clientId={client.id} clientName={client.name} />;
  }

  const sortedKeywords = (() => {
    // null/undefined를 항상 끝으로 보내는 timestamp 비교
    const compareTimestamp = (aStr: string | null, bStr: string | null, dir: "asc" | "desc") => {
      const aNull = !aStr;
      const bNull = !bStr;
      if (aNull && bNull) return 0;
      if (aNull) return 1; // null은 항상 끝으로
      if (bNull) return -1;
      const aT = new Date(aStr!).getTime();
      const bT = new Date(bStr!).getTime();
      return dir === "desc" ? bT - aT : aT - bT;
    };

    if (keywordSort !== "none") {
      return [...keywords].sort((a, b) => {
        const cmp = a.keyword.localeCompare(b.keyword, "ko");
        return keywordSort === "asc" ? cmp : -cmp;
      });
    }
    if (updatedSort !== "none") {
      return [...keywords].sort((a, b) => compareTimestamp(a.updated_at, b.updated_at, updatedSort));
    }
    if (createdSort !== "none") {
      return [...keywords].sort((a, b) => compareTimestamp(a.created_at, b.created_at, createdSort));
    }
    if (prioritySort !== "none") {
      return [...keywords].sort((a, b) => {
        const aPri = (a as Keyword).priority ?? 3;
        const bPri = (b as Keyword).priority ?? 3;
        return prioritySort === "desc" ? bPri - aPri : aPri - bPri;
      });
    }
    if (rankSort !== "none") {
      return [...keywords].sort((a, b) => {
        const aRank = a.current_rank;
        const bRank = b.current_rank;
        if (aRank === null && bRank === null) return 0;
        if (aRank === null) return 1;
        if (bRank === null) return -1;
        return rankSort === "asc" ? aRank - bRank : bRank - aRank;
      });
    }
    return keywords;
  })();

  const blogUrl = isBlog ? (client as Client).blog_url : null;
  const exposedKeywords = sortedKeywords.filter(
    (kw) => (kw.current_rank !== null || kw.smart_block_rank !== null) && !(kw as CafeKeyword).is_reply
  );
  const unexposedKeywords = sortedKeywords.filter(
    (kw) => (kw.current_rank === null && kw.smart_block_rank === null) || (kw as CafeKeyword).is_reply
  );

  // 키워드 행 렌더러 (PC 테이블)
  const renderKeywordRow = (kw: AnyKeyword, index: number) => (
    <motion.tr
      key={kw.id}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors"
    >
      <td className="px-5 py-4 font-medium text-slate-800">
        {editingId === kw.id ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveEdit(kw.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                placeholder="키워드"
                className={`px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-40`}
              />
              <button onClick={() => handleSaveEdit(kw.id)} className="text-green-500 hover:text-green-700 font-bold text-sm">✓</button>
              <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
            </div>
            {!isBlog && (
              <>
                <input
                  value={editingPostUrl}
                  onChange={(e) => setEditingPostUrl(e.target.value)}
                  placeholder="포스팅 URL"
                  className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-56`}
                />
                <input
                  value={editingPostTitle}
                  onChange={(e) => setEditingPostTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(kw.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder="포스팅 제목"
                  className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-56`}
                />
                <input
                  value={editingAuthorName}
                  onChange={(e) => setEditingAuthorName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(kw.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder="작성자"
                  className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-40`}
                />
                <input
                  value={editingCafeName}
                  onChange={(e) => setEditingCafeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(kw.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder="카페 이름"
                  className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-40`}
                />
                <input
                  type="date"
                  value={editingCreatedAt}
                  onChange={(e) => setEditingCreatedAt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(kw.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  title="등록일 (발행일)"
                  className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-40`}
                />
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => setHistoryKeyword({ id: kw.id, name: kw.keyword })}
            className={`transition-colors cursor-pointer text-left ${isDroppedFromTop7(kw) ? "text-red-500 hover:text-red-600" : accentHover}`}
            title="순위 변화 보기"
          >
            {kw.keyword}
          </button>
        )}
        {!isBlog && editingId !== kw.id && (
          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
            {(kw as CafeKeyword).post_title ?? (kw as CafeKeyword).post_url ?? ""}
          </p>
        )}
      </td>
      {isBlog ? (
        <td className="px-5 py-4 text-center">
          <div className="flex justify-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handlePriorityChange(kw.id, star)}
                className={`text-sm transition-colors ${star <= ((kw as Keyword).priority ?? 3) ? "text-amber-400" : "text-slate-200 hover:text-amber-300"}`}
              >
                ★
              </button>
            ))}
          </div>
        </td>
      ) : (
        <td className="px-5 py-4 text-sm max-w-[160px]">
          <div className="text-slate-500 truncate">
            {(kw as CafeKeyword).author_name ?? <span className="text-slate-300">-</span>}
          </div>
          {(() => {
            const c = getCafeDisplay(kw as CafeKeyword);
            if (c.source === "user") {
              return <div className="text-xs text-violet-600 mt-0.5 truncate">{c.name}</div>;
            }
            return (
              <button
                onClick={() => {
                  setEditingId(kw.id);
                  setEditingText(kw.keyword);
                  setEditingPostUrl((kw as CafeKeyword).post_url ?? "");
                  setEditingPostTitle((kw as CafeKeyword).post_title ?? "");
                  setEditingAuthorName((kw as CafeKeyword).author_name ?? "");
                  setEditingCafeName((kw as CafeKeyword).cafe_name ?? "");
                  setEditingCreatedAt((kw.created_at ?? "").slice(0, 10));
                }}
                className="text-xs text-red-500 hover:underline mt-0.5"
                title="카페를 분류하려면 클릭"
              >
                미분류 ✏️
              </button>
            );
          })()}
        </td>
      )}
      <td className="px-5 py-4 text-center">
        <RankBadge rank={kw.current_rank} smartBlockName={kw.smart_block_name} smartBlockRank={kw.smart_block_rank} isReply={(kw as CafeKeyword).is_reply} replySince={(kw as CafeKeyword).reply_since} />
      </td>
      <td className="px-5 py-4 text-center">
        <RankChange current={kw.current_rank} previous={kw.previous_rank} />
      </td>
      <td className="px-5 py-4">
        {kw.matched_title === "[삭제된 게시글]" ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-yellow-50 text-red-600 text-xs font-bold border-2 border-yellow-400">
            ❌ 삭제된 게시글
          </span>
        ) : kw.matched_url ? (
          <a href={kw.matched_url} target="_blank" rel="noopener noreferrer" className={`text-sm ${accentText} hover:underline truncate block max-w-xs`}>
            {kw.matched_title ?? kw.matched_url}
          </a>
        ) : (
          <span className="text-sm text-slate-300">{!isBlog && kw.current_rank === null ? "미노출" : "-"}</span>
        )}
      </td>
      <td className="px-5 py-4 text-xs text-slate-400">{formatDate(kw.updated_at)}</td>
      {!isBlog && (() => {
        const { dateLabel, days } = formatCreatedDate(kw.created_at);
        const isUnexposed = kw.current_rank === null && kw.smart_block_rank === null || (kw as CafeKeyword).is_reply;
        const isOld = days >= 30 && isUnexposed;
        return (
          <td className={`px-5 py-4 text-xs ${isOld ? "text-red-500 font-semibold" : "text-slate-400"}`}>
            <div>{dateLabel}</div>
            <div>({days}일 지남)</div>
          </td>
        );
      })()}
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <button onClick={() => handleRefreshKeyword(kw)} disabled={refreshingId === kw.id || isCooldown(kw.updated_at, kw.created_at)} title={isCooldown(kw.updated_at, kw.created_at) ? cooldownRemaining(kw.updated_at) : "순위 새로고침"} className={`text-slate-400 ${isCooldown(kw.updated_at, kw.created_at) ? "opacity-30 cursor-not-allowed" : accentRefresh} transition-colors`}>
            <RefreshIcon spinning={refreshingId === kw.id} />
          </button>
          {!isBlog && (
            <button
              onClick={() => handleToggleDeleted(kw)}
              title={kw.matched_title === "[삭제된 게시글]" ? "삭제 표시 해제" : "삭제된 게시글로 표시"}
              className={`text-xs px-2 py-1 rounded font-bold transition-colors ${
                kw.matched_title === "[삭제된 게시글]"
                  ? "bg-yellow-50 text-red-600 border-2 border-yellow-400"
                  : "text-slate-400 hover:text-red-500 border-2 border-transparent hover:border-yellow-300"
              }`}
            >
              {kw.matched_title === "[삭제된 게시글]" ? "삭제됨 ✓" : "삭제표시"}
            </button>
          )}
          <button onClick={() => { setEditingId(kw.id); setEditingText(kw.keyword); setEditingPostUrl((kw as CafeKeyword).post_url ?? ""); setEditingPostTitle((kw as CafeKeyword).post_title ?? ""); setEditingAuthorName((kw as CafeKeyword).author_name ?? ""); setEditingCafeName((kw as CafeKeyword).cafe_name ?? ""); setEditingCreatedAt((kw.created_at ?? "").slice(0, 10)); }} title="키워드 수정" className="text-slate-400 hover:text-blue-500 transition-colors">
            <PencilIcon />
          </button>
          <button onClick={() => handleDeleteKeyword(kw.id)} title="키워드 삭제" className="text-slate-400 hover:text-red-500 transition-colors">
            <DeleteIcon />
          </button>
        </div>
      </td>
    </motion.tr>
  );

  // 키워드 카드 렌더러 (모바일)
  const renderKeywordCard = (kw: AnyKeyword, index: number) => (
    <motion.div
      key={kw.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          {editingId === kw.id ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(kw.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  placeholder="키워드"
                  className={`px-2 py-1 text-sm border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-32`}
                />
                <button onClick={() => handleSaveEdit(kw.id)} className="text-green-500 font-bold text-sm">✓</button>
                <button onClick={() => setEditingId(null)} className="text-slate-400 text-sm">✕</button>
              </div>
              {!isBlog && (
                <>
                  <input
                    value={editingPostUrl}
                    onChange={(e) => setEditingPostUrl(e.target.value)}
                    placeholder="포스팅 URL"
                    className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-48`}
                  />
                  <input
                    value={editingPostTitle}
                    onChange={(e) => setEditingPostTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(kw.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    placeholder="포스팅 제목"
                    className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-48`}
                  />
                  <input
                    value={editingAuthorName}
                    onChange={(e) => setEditingAuthorName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(kw.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    placeholder="작성자"
                    className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-36`}
                  />
                  <input
                    value={editingCafeName}
                    onChange={(e) => setEditingCafeName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(kw.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    placeholder="카페 이름"
                    className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-36`}
                  />
                  <input
                    type="date"
                    value={editingCreatedAt}
                    onChange={(e) => setEditingCreatedAt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(kw.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    title="등록일 (발행일)"
                    className={`px-2 py-1 text-xs border rounded-lg outline-none focus:ring-2 ${accentFocus} text-slate-800 w-36`}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setHistoryKeyword({ id: kw.id, name: kw.keyword })}
                className={`font-medium transition-colors text-left ${isDroppedFromTop7(kw) ? "text-red-500 hover:text-red-600" : `text-slate-800 ${accentHover}`}`}
              >
                {kw.keyword}
              </button>
              {!isBlog && (kw as CafeKeyword).author_name && (
                <span className="text-xs text-slate-400">({(kw as CafeKeyword).author_name})</span>
              )}
            </div>
          )}
          {!isBlog && editingId !== kw.id && (
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">
              {(kw as CafeKeyword).post_title ?? (kw as CafeKeyword).post_url ?? ""}
            </p>
          )}
          {!isBlog && editingId !== kw.id && (() => {
            const c = getCafeDisplay(kw as CafeKeyword);
            if (c.source === "user") {
              return <p className="text-xs text-violet-600 mt-0.5 truncate max-w-[200px]">📍 {c.name}</p>;
            }
            return (
              <button
                onClick={() => {
                  setEditingId(kw.id);
                  setEditingText(kw.keyword);
                  setEditingPostUrl((kw as CafeKeyword).post_url ?? "");
                  setEditingPostTitle((kw as CafeKeyword).post_title ?? "");
                  setEditingAuthorName((kw as CafeKeyword).author_name ?? "");
                  setEditingCafeName((kw as CafeKeyword).cafe_name ?? "");
                  setEditingCreatedAt((kw.created_at ?? "").slice(0, 10));
                }}
                className="text-xs text-red-500 hover:underline mt-0.5"
              >
                📍 미분류 ✏️
              </button>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleRefreshKeyword(kw)} disabled={refreshingId === kw.id || isCooldown(kw.updated_at, kw.created_at)} title={isCooldown(kw.updated_at, kw.created_at) ? cooldownRemaining(kw.updated_at) : "순위 새로고침"} className={`text-slate-400 ${isCooldown(kw.updated_at, kw.created_at) ? "opacity-30 cursor-not-allowed" : accentRefresh} transition-colors p-1`}>
            <RefreshIcon spinning={refreshingId === kw.id} />
          </button>
          {!isBlog && (
            <button
              onClick={() => handleToggleDeleted(kw)}
              className={`text-xs px-2 py-1 rounded font-bold transition-colors ${
                kw.matched_title === "[삭제된 게시글]"
                  ? "bg-yellow-50 text-red-600 border-2 border-yellow-400"
                  : "text-slate-400 hover:text-red-500 border-2 border-transparent hover:border-yellow-300"
              }`}
            >
              {kw.matched_title === "[삭제된 게시글]" ? "삭제됨 ✓" : "삭제표시"}
            </button>
          )}
          <button onClick={() => { setEditingId(kw.id); setEditingText(kw.keyword); setEditingPostUrl((kw as CafeKeyword).post_url ?? ""); setEditingPostTitle((kw as CafeKeyword).post_title ?? ""); setEditingAuthorName((kw as CafeKeyword).author_name ?? ""); setEditingCafeName((kw as CafeKeyword).cafe_name ?? ""); setEditingCreatedAt((kw.created_at ?? "").slice(0, 10)); }} className="text-slate-400 hover:text-blue-500 transition-colors p-1">
            <PencilIcon />
          </button>
          <button onClick={() => handleDeleteKeyword(kw.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
            <DeleteIcon />
          </button>
        </div>
      </div>
      {isBlog && (
        <div className="flex gap-0.5 mb-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handlePriorityChange(kw.id, star)}
              className={`text-sm transition-colors ${star <= ((kw as Keyword).priority ?? 3) ? "text-amber-400" : "text-slate-200 hover:text-amber-300"}`}
            >
              ★
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mb-2">
        <RankBadge rank={kw.current_rank} smartBlockName={kw.smart_block_name} smartBlockRank={kw.smart_block_rank} isReply={(kw as CafeKeyword).is_reply} replySince={(kw as CafeKeyword).reply_since} />
        <RankChange current={kw.current_rank} previous={kw.previous_rank} />
      </div>
      {kw.matched_title === "[삭제된 게시글]" ? (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-yellow-50 text-red-600 text-xs font-bold border-2 border-yellow-400 mb-1">
          ❌ 삭제된 게시글
        </span>
      ) : kw.matched_url ? (
        <a href={kw.matched_url} target="_blank" rel="noopener noreferrer" className={`text-xs ${accentText} hover:underline truncate block mb-1`}>
          {kw.matched_title ?? kw.matched_url}
        </a>
      ) : null}
      <p className="text-xs text-slate-400">{formatDate(kw.updated_at)}</p>
      {!isBlog && (() => {
        const { dateLabel, days } = formatCreatedDate(kw.created_at);
        const isUnexposed = kw.current_rank === null && kw.smart_block_rank === null || (kw as CafeKeyword).is_reply;
        const isOld = days >= 30 && isUnexposed;
        return (
          <p className={`text-xs mt-0.5 ${isOld ? "text-red-500 font-semibold" : "text-slate-400"}`}>
            등록일 {dateLabel} ({days}일 지남)
          </p>
        );
      })()}
    </motion.div>
  );

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-16 md:pt-8">
      {/* 헤더 */}
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800">{client.name}</h2>
          <div className="flex flex-wrap items-center gap-2 md:gap-4 mt-1">
            {client.assignee && <span className="text-sm text-slate-500">담당: {client.assignee}</span>}
            {isBlog && blogUrl && (
              <a href={`https://${blogUrl}`} target="_blank" rel="noopener noreferrer" className={`text-sm ${accentText} hover:underline break-all`}>
                {blogUrl}
              </a>
            )}
            <button onClick={handleDeleteClient} disabled={deletingClient} className="text-xs text-red-400 hover:text-red-600 transition-colors">
              {entityLabel} 삭제
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start shrink-0">
          {!isBlog && (
            <button
              onClick={() => setActiveView(activeView === "stats" ? "keywords" : "stats")}
              className={`px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                activeView === "stats"
                  ? "bg-violet-500 text-white hover:bg-violet-600"
                  : "bg-white border-2 border-violet-200 text-violet-600 hover:bg-violet-50"
              }`}
              title="월별 발행 통계"
            >
              📊 {activeView === "stats" ? "키워드로" : "통계"}
            </button>
          )}
          {!isBlog && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleExportExcel}
              disabled={exportLoading}
              className="px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5"
            >
              {exportLoading ? "생성 중..." : "엑셀 다운로드"}
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleBatchRefresh}
            disabled={batchLoading || batchCooldown}
            title={batchCooldown ? batchCooldownLabel : ""}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
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
      </div>

      <AnimatePresence>
        {batchMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-sm px-4 py-3 rounded-xl mb-4 ${accentBg}`}
          >
            {batchMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 블로그 모드: 기존 테이블/카드 */}
      {isBlog ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full hidden md:table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th
                  className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-48 cursor-pointer select-none hover:text-emerald-600 transition-colors"
                  onClick={() => { setKeywordSort(prev => prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"); setPrioritySort("none"); setRankSort("none"); setUpdatedSort("none"); setCreatedSort("none"); }}
                >
                  키워드 {keywordSort === "asc" ? "▲" : keywordSort === "desc" ? "▼" : ""}
                </th>
                <th
                  className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-28 cursor-pointer select-none hover:text-emerald-600 transition-colors"
                  onClick={() => { setPrioritySort(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"); setKeywordSort("none"); setRankSort("none"); setUpdatedSort("none"); setCreatedSort("none"); }}
                >
                  중요도 {prioritySort === "desc" ? "▼" : prioritySort === "asc" ? "▲" : ""}
                </th>
                <th
                  className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24 cursor-pointer select-none hover:text-emerald-600 transition-colors"
                  onClick={() => { setRankSort(prev => prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"); setKeywordSort("none"); setPrioritySort("none"); setUpdatedSort("none"); setCreatedSort("none"); }}
                >
                  현재 순위 {rankSort === "asc" ? "▲" : rankSort === "desc" ? "▼" : ""}
                </th>
                <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">변화</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">매칭 포스트</th>
                <th
                  className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-36 cursor-pointer select-none hover:text-emerald-600 transition-colors"
                  onClick={() => { setUpdatedSort(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"); setKeywordSort("none"); setPrioritySort("none"); setRankSort("none"); setCreatedSort("none"); }}
                >
                  마지막 갱신 {updatedSort === "desc" ? "▼" : updatedSort === "asc" ? "▲" : ""}
                </th>
                <th className="px-5 py-3.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">불러오는 중...</td></tr>
              ) : keywords.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">등록된 키워드가 없습니다</td></tr>
              ) : (
                sortedKeywords.map((kw, i) => renderKeywordRow(kw, i))
              )}
            </tbody>
          </table>

          <div className="md:hidden">
            {loading ? (
              <div className="text-center py-12 text-slate-400">불러오는 중...</div>
            ) : sortedKeywords.length === 0 ? (
              <div className="text-center py-12 text-slate-400">등록된 키워드가 없습니다</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sortedKeywords.map((kw, i) => renderKeywordCard(kw, i))}
              </div>
            )}
          </div>

          <form onSubmit={handleAddKeyword} className="flex items-center gap-3 px-4 md:px-5 py-4 border-t border-slate-100 bg-slate-50/50">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="새 키워드 입력"
              className={`flex-1 px-3 md:px-4 py-2 text-sm rounded-xl border border-slate-200 ${accentFocus} focus:ring-2 outline-none text-slate-800 placeholder:text-slate-400`}
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={addingKeyword || !newKeyword.trim()}
              className={`px-4 md:px-5 py-2 ${accentBtn} disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors shrink-0`}
            >
              {addingKeyword ? "..." : "추가"}
            </motion.button>
          </form>
        </div>
      ) : (
        /* 카페 모드: 노출/미노출 섹션 */
        <div className="space-y-4">
          {/* 노출 중 섹션 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-violet-700">노출 중</span>
              <span className="text-xs text-violet-500">{exposedKeywords.length}개</span>
            </div>

            <table className="w-full hidden md:table">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setKeywordSort(prev => prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"); setRankSort("none"); setUpdatedSort("none"); setPrioritySort("none"); setCreatedSort("none"); }}
                  >
                    키워드 / 포스팅 {keywordSort === "asc" ? "▲" : keywordSort === "desc" ? "▼" : ""}
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">작성자</th>
                  <th
                    className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24 cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setRankSort(prev => prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"); setKeywordSort("none"); setUpdatedSort("none"); setPrioritySort("none"); setCreatedSort("none"); }}
                  >
                    순위 {rankSort === "asc" ? "▲" : rankSort === "desc" ? "▼" : ""}
                  </th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">변화</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">노출 URL</th>
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-36 cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setUpdatedSort(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"); setKeywordSort("none"); setRankSort("none"); setPrioritySort("none"); setCreatedSort("none"); }}
                  >
                    마지막 갱신 {updatedSort === "desc" ? "▼" : updatedSort === "asc" ? "▲" : ""}
                  </th>
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-32 cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setCreatedSort(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"); setKeywordSort("none"); setRankSort("none"); setUpdatedSort("none"); setPrioritySort("none"); }}
                  >
                    등록일 {createdSort === "desc" ? "▼" : createdSort === "asc" ? "▲" : ""}
                  </th>
                  <th className="px-5 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">불러오는 중...</td></tr>
                ) : exposedKeywords.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">노출 중인 키워드가 없습니다</td></tr>
                ) : (
                  exposedKeywords.map((kw, i) => renderKeywordRow(kw, i))
                )}
              </tbody>
            </table>

            <div className="md:hidden">
              {loading ? (
                <div className="text-center py-8 text-slate-400">불러오는 중...</div>
              ) : exposedKeywords.length === 0 ? (
                <div className="text-center py-8 text-slate-400">노출 중인 키워드가 없습니다</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {exposedKeywords.map((kw, i) => renderKeywordCard(kw, i))}
                </div>
              )}
            </div>
          </div>

          {/* 미노출 섹션 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500">미노출</span>
              <span className="text-xs text-slate-400">{unexposedKeywords.length}개</span>
            </div>

            <table className="w-full hidden md:table">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setKeywordSort(prev => prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"); setRankSort("none"); setUpdatedSort("none"); setPrioritySort("none"); setCreatedSort("none"); }}
                  >
                    키워드 / 포스팅 {keywordSort === "asc" ? "▲" : keywordSort === "desc" ? "▼" : ""}
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">작성자</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">상태</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">변화</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide"></th>
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-36 cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setUpdatedSort(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"); setKeywordSort("none"); setRankSort("none"); setPrioritySort("none"); setCreatedSort("none"); }}
                  >
                    마지막 갱신 {updatedSort === "desc" ? "▼" : updatedSort === "asc" ? "▲" : ""}
                  </th>
                  <th
                    className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-32 cursor-pointer select-none hover:text-violet-600 transition-colors"
                    onClick={() => { setCreatedSort(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none"); setKeywordSort("none"); setRankSort("none"); setUpdatedSort("none"); setPrioritySort("none"); }}
                  >
                    등록일 {createdSort === "desc" ? "▼" : createdSort === "asc" ? "▲" : ""}
                  </th>
                  <th className="px-5 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">불러오는 중...</td></tr>
                ) : unexposedKeywords.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400 text-sm">미노출 키워드가 없습니다 🎉</td></tr>
                ) : (
                  unexposedKeywords.map((kw, i) => renderKeywordRow(kw, i))
                )}
              </tbody>
            </table>

            <div className="md:hidden">
              {loading ? (
                <div className="text-center py-8 text-slate-400">불러오는 중...</div>
              ) : unexposedKeywords.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">미노출 키워드가 없습니다 🎉</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {unexposedKeywords.map((kw, i) => renderKeywordCard(kw, i))}
                </div>
              )}
            </div>
          </div>

          {/* 카페 키워드 추가 폼 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 md:p-5">
            <p className="text-sm font-semibold text-slate-700 mb-3">키워드 추가</p>
            <form onSubmit={handleAddKeyword} className="space-y-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="키워드 (필수)"
                className={`w-full px-4 py-2 text-sm rounded-xl border border-slate-200 ${accentFocus} focus:ring-2 outline-none text-slate-800 placeholder:text-slate-400`}
              />
              <input
                type="text"
                value={newPostUrl}
                onChange={(e) => setNewPostUrl(e.target.value)}
                placeholder="포스팅 URL (예: https://cafe.naver.com/mycafe/12345)"
                className={`w-full px-4 py-2 text-sm rounded-xl border border-slate-200 ${accentFocus} focus:ring-2 outline-none text-slate-800 placeholder:text-slate-400`}
              />
              <input
                type="text"
                value={newPostTitle}
                onChange={(e) => setNewPostTitle(e.target.value)}
                placeholder="포스팅 제목 (URL 없으면 필수)"
                className={`w-full px-4 py-2 text-sm rounded-xl border border-slate-200 ${accentFocus} focus:ring-2 outline-none text-slate-800 placeholder:text-slate-400`}
              />
              <input
                type="text"
                value={newAuthorName}
                onChange={(e) => setNewAuthorName(e.target.value)}
                placeholder="작성자 (선택)"
                className={`w-full px-4 py-2 text-sm rounded-xl border border-slate-200 ${accentFocus} focus:ring-2 outline-none text-slate-800 placeholder:text-slate-400`}
              />
              <input
                type="text"
                value={newCafeName}
                onChange={(e) => setNewCafeName(e.target.value)}
                placeholder="카페 이름 (선택, 예: 부산맘카페 — 통계용)"
                className={`w-full px-4 py-2 text-sm rounded-xl border border-slate-200 ${accentFocus} focus:ring-2 outline-none text-slate-800 placeholder:text-slate-400`}
              />
              {addError && <p className="text-red-500 text-xs">{addError}</p>}
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={addingKeyword || !newKeyword.trim()}
                className={`w-full py-2 ${accentBtn} disabled:bg-slate-300 text-white text-sm font-medium rounded-xl transition-colors`}
              >
                {addingKeyword ? "추가 중..." : "키워드 추가"}
              </motion.button>
            </form>
          </div>
        </div>
      )}

      <AnimatePresence>
        {historyKeyword && (
          <RankHistory
            keywordId={historyKeyword.id}
            keywordName={historyKeyword.name}
            onClose={() => setHistoryKeyword(null)}
            historyApiPath={historyApi}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
