"use client";

import { useEffect, useState } from "react";

// 제품 언급 순위 스캔.
// 키워드를 넣으면 네이버 통합검색(PC) 결과의 블로그·카페 글 본문을 읽어,
// 우리 제품명이 언급된 글이 화면 전체 순서로 몇 번째인지 보여준다.

type Level = "main" | "switch" | "light" | "passing" | "comment_only" | "none";

interface Analysis {
  level: Level;
  label: string;
  count: number;
  commentCount: number;
  inTitle: boolean;
  firstPosition: number | null;
  recommendCue: boolean;
  negativeCue: boolean;
  snippets: string[];
}

interface Item {
  rank: number;
  kind: "blog" | "cafe" | "web";
  title: string;
  link: string;
  note: string | null;
  analysis: Analysis | null;
  registered?: string | null; // 대시보드에 등록된 우리 글이면 브랜드 이름
}

interface Summary {
  total: number;
  analyzed: number;
  unreadable: number;
  mentioned: number;
  promoting: number;
  bestRank: number | null;
  ranks: number[];
}

interface ScanResult {
  keyword: string;
  terms: string[];
  scannedAt: string;
  summary: Summary;
  items: Item[];
  saved?: boolean;
}

interface ScanRecord {
  id: number;
  keyword: string;
  terms: string[];
  scanned_at: string;
  summary: Summary;
}

const TERMS_KEY = "mention-scan-terms";
const DEFAULT_TERMS = "솔커트, 테르피노";

const KIND_LABEL = { blog: "블로그", cafe: "카페", web: "외부" } as const;

const LEVEL_STYLE: Record<Level, string> = {
  main: "bg-violet-600 text-white border-violet-600",
  switch: "bg-violet-50 text-violet-700 border-violet-300",
  light: "bg-violet-50 text-violet-700 border-violet-200",
  comment_only: "bg-sky-50 text-sky-700 border-sky-200",
  passing: "bg-slate-100 text-slate-500 border-slate-200",
  none: "",
};

const LEVEL_HELP: Record<Level, string> = {
  main: "제목에 제품명이 있거나, 글 앞부분부터 여러 번 다룸",
  switch: "다른 주제로 시작해 글 중간부터 제품으로 넘어감",
  light: "1~2번 언급하면서 추천·구매 표현이 함께 있음",
  comment_only: "본문에는 없고 댓글에서만 언급",
  passing: "1~2번 스쳐 지나가듯 언급",
  none: "",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MentionScanSection() {
  const [keyword, setKeyword] = useState("");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [onlyMentioned, setOnlyMentioned] = useState(false);
  const [records, setRecords] = useState<ScanRecord[]>([]);

  const loadRecords = () =>
    fetch("/api/mention-scan", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d?.scans) setRecords(d.scans);
      })
      .catch(() => {});

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TERMS_KEY);
      if (saved) setTerms(saved);
    } catch {
      // 저장소를 쓸 수 없는 환경이면 기본값 사용
    }
    loadRecords();
  }, []);

  const scan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      localStorage.setItem(TERMS_KEY, terms);
    } catch {
      // 무시
    }
    try {
      const res = await fetch("/api/mention-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), terms: terms.split(",").map((t) => t.trim()).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "스캔에 실패했습니다.");
      else {
        setResult(data);
        loadRecords();
      }
    } catch {
      setError("스캔 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const openRecord = async (id: number) => {
    setError("");
    const res = await fetch(`/api/mention-scan?id=${id}`, { cache: "no-store" });
    if (res.ok) setResult(await res.json());
    else setError("기록을 불러오지 못했습니다.");
  };

  const isOurs = (it: Item) => !!it.registered || (!!it.analysis && it.analysis.level !== "none");
  const shown = result ? (onlyMentioned ? result.items.filter(isOurs) : result.items) : [];

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-slate-800">제품 언급 순위 스캔</h2>
        <span className="text-[11px] text-slate-400">
          키워드를 검색해 상위 블로그·카페 글 본문에서 제품명을 찾습니다 · 순위는 PC 통합검색 화면 전체 순서
        </span>
      </div>

      <form onSubmit={scan} className="px-5 py-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[220px]">
          <span className="block text-xs font-medium text-slate-500 mb-1">키워드</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="예: 팥순이 다이어트 부작용"
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 text-slate-800"
          />
        </label>
        <label className="w-64">
          <span className="block text-xs font-medium text-slate-500 mb-1">찾을 제품명 (쉼표로 구분)</span>
          <input
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 text-slate-800"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !keyword.trim()}
          className="px-5 py-2 text-sm font-semibold rounded-xl bg-violet-500 hover:bg-violet-600 disabled:bg-slate-300 text-white transition-colors"
        >
          {loading ? "스캔 중... (10~30초)" : "스캔"}
        </button>
      </form>

      {error && <div className="mx-5 mb-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-2.5">{error}</div>}

      {result && (
        <div className="border-t border-slate-100">
          <div className="px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 bg-violet-50/40">
            <div>
              <div className="text-[11px] text-slate-500">
                “{result.keyword}” · {result.terms.join(", ")} · {when(result.scannedAt)}
              </div>
              <div className="text-base font-bold text-slate-800 mt-0.5">
                {result.summary.bestRank !== null ? (
                  <>
                    제품을 알리는 글 최고 <span className="text-violet-600">{result.summary.bestRank}위</span>
                    <span className="text-sm font-medium text-slate-500"> · 총 {result.summary.promoting}개 ({result.summary.ranks.join(", ")}위)</span>
                  </>
                ) : (
                  <span className="text-slate-500">제품을 알리는 글이 상위 {result.summary.total}개 안에 없습니다</span>
                )}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
              <span>
                결과 {result.summary.total}개 중 본문 확인 {result.summary.analyzed}개
                {result.summary.unreadable > 0 && ` · 확인 불가 ${result.summary.unreadable}개`}
              </span>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={onlyMentioned} onChange={(e) => setOnlyMentioned(e.target.checked)} />
                우리 글만
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500">
                  <th className="px-5 py-2.5 text-right font-semibold w-20 whitespace-nowrap">순위</th>
                  <th className="px-3 py-2.5 text-left font-semibold w-16">종류</th>
                  <th className="px-3 py-2.5 text-left font-semibold">글</th>
                  <th className="px-3 py-2.5 text-left font-semibold w-64">제품 언급</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => {
                  const a = it.analysis;
                  const hit = a && a.level !== "none";
                  return (
                    <tr key={it.rank} className={`border-t border-slate-50 align-top ${hit || it.registered ? "bg-violet-50/30" : ""}`}>
                      <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-700">{it.rank}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{KIND_LABEL[it.kind]}</td>
                      <td className="px-3 py-2.5 min-w-[260px]">
                        <a href={it.link} target="_blank" rel="noopener noreferrer" className="text-slate-800 hover:text-violet-600 hover:underline">
                          {it.title}
                        </a>
                        {hit &&
                          a.snippets.map((s, i) => (
                            <p key={i} className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                              {s}
                            </p>
                          ))}
                      </td>
                      <td className="px-3 py-2.5">
                        {it.registered && (
                          <div className="mb-1">
                            <span
                              className="inline-block px-2 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-[11px] font-semibold"
                              title="대시보드에 등록된 글과 주소가 일치합니다"
                            >
                              등록된 우리 글 · {it.registered}
                            </span>
                          </div>
                        )}
                        {hit ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-block px-2 py-0.5 rounded border text-[11px] font-semibold ${LEVEL_STYLE[a.level]}`}
                              title={LEVEL_HELP[a.level]}
                            >
                              {a.label}
                            </span>
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              {a.count > 0 && (
                                <span>
                                  본문 {a.count}회
                                  {a.firstPosition !== null && ` · 글의 ${Math.round(a.firstPosition * 100)}% 지점부터`}
                                </span>
                              )}
                              {a.commentCount > 0 && <span>{a.count > 0 ? " · " : ""}댓글 {a.commentCount}회</span>}
                              {a.inTitle && <span> · 제목에 포함</span>}
                            </div>
                            {a.negativeCue && (
                              <div className="text-[11px] font-medium text-amber-600">⚠ 제품명 뒤에 부정 표현 — 직접 확인 필요</div>
                            )}
                          </div>
                        ) : (
                          <span className={`text-[11px] ${it.registered ? "text-slate-500" : "text-slate-300"}`}>{it.note ?? "언급 없음"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">
                      제품명이 언급된 글이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {records.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-3">
          <div className="text-xs font-medium text-slate-500 mb-2">최근 스캔</div>
          <div className="flex flex-wrap gap-1.5">
            {records.slice(0, 16).map((r) => (
              <button
                key={r.id}
                onClick={() => openRecord(r.id)}
                className="px-2.5 py-1 text-xs rounded-full border border-slate-200 text-slate-600 hover:border-violet-400 hover:text-violet-600 transition-colors"
                title={`${r.terms.join(", ")} · ${when(r.scanned_at)}`}
              >
                {r.keyword}{" "}
                <span className={`tabular-nums font-semibold ${r.summary.bestRank !== null ? "text-violet-600" : "text-slate-300"}`}>
                  {r.summary.bestRank !== null ? `${r.summary.bestRank}위` : "없음"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
