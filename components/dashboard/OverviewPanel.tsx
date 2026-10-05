"use client";

import { useEffect, useState } from "react";
import type { Client, CafeClient } from "@/lib/types";
import HealthSection from "./HealthSection";

// 병원/브랜드를 고르기 전에 보이는 전체 홈 화면.
// 블로그: 조치 목록(상위권 이탈·새 진입·최근 수집에서 빠진 키워드) + 병원별 요약
// 카페:   위닝 글(조회수 기준) + 브랜드별 요약

type AnyClient = Client | CafeClient;

interface BlogOverview {
  latestAt: string | null;
  latestDate: string | null;
  totals: { keywords: number; top: number; exposed: number; stale: number };
  dropped: { clientId: string; clientName: string; keyword: string; previous: number; current: number | null }[];
  entered: { clientId: string; clientName: string; keyword: string; previous: number | null; current: number }[];
  clients: { client: Client; total: number; top: number; exposed: number; dropped: number; entered: number; stale: number }[];
}

interface CafeOverview {
  statsDate: string | null;
  statsError: string | null;
  hasDelta: boolean;
  observedPosts: number;
  winning: {
    clientId: string;
    clientName: string;
    postUrl: string | null;
    cafeName: string | null;
    publishedAt: string | null;
    keywords: { keyword: string; rank: number | null; isReply: boolean }[];
    readCount: number;
    commentCount: number | null;
    delta: number | null;
    memberCount: number | null;
  }[];
  clients: {
    client: CafeClient;
    total: number;
    exposed: number;
    reply: number;
    deleted: number;
    winningPosts: number;
    restrictedPosts: number;
  }[];
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function Tile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "good" | "bad" | "warn" }) {
  const color =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-500" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {note && <span className="text-[11px] text-slate-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="px-5 py-8 text-center text-sm text-slate-400">{children}</div>
);

export default function OverviewPanel({
  mode,
  onSelectClient,
}: {
  mode: "blog" | "cafe";
  onSelectClient?: (client: AnyClient) => void;
}) {
  const [blog, setBlog] = useState<BlogOverview | null>(null);
  const [cafe, setCafe] = useState<CafeOverview | null>(null);
  const [error, setError] = useState("");
  const [showAllWinning, setShowAllWinning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(mode === "blog" ? "/api/overview" : "/api/cafe/overview", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? "요약을 불러오지 못했습니다.");
        else if (mode === "blog") setBlog(data);
        else setCafe(data);
      })
      .catch(() => {
        if (!cancelled) setError("요약을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const data = mode === "blog" ? blog : cafe;

  return (
    <main className="flex-1 p-4 pt-16 md:p-8 md:pt-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800">
            {mode === "blog" ? "블로그 전체 현황" : "카페 전체 현황"}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            왼쪽에서 {mode === "blog" ? "병원" : "브랜드"}을 고르면 키워드별 화면으로 이동합니다.
          </p>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>}
        {!data && !error && <div className="text-sm text-slate-400 py-12 text-center">불러오는 중...</div>}

        {mode === "blog" && blog && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="전체 키워드" value={fmt(blog.totals.keywords)} sub={`노출 중 ${fmt(blog.totals.exposed)}개`} />
              <Tile label="7위 이내" value={fmt(blog.totals.top)} tone="good" sub="PC 통합검색 화면 순서 기준" />
              <Tile label="상위권 이탈" value={fmt(blog.dropped.length)} tone={blog.dropped.length ? "bad" : "default"} sub="직전 수집 대비" />
              <Tile
                label="최근 수집"
                value={blog.latestDate ? blog.latestDate.slice(5).replace("-", "/") : "-"}
                tone={blog.totals.stale ? "warn" : "default"}
                sub={blog.totals.stale ? `이번 수집에서 빠진 키워드 ${fmt(blog.totals.stale)}개` : formatDateTime(blog.latestAt)}
              />
            </div>

            <HealthSection mode="blog" />

            <div className="grid md:grid-cols-2 gap-5">
              <Section title="상위권 이탈" note="직전 수집에서 7위 이내였다가 밀려난 키워드">
                {blog.dropped.length === 0 ? (
                  <Empty>이탈한 키워드가 없습니다.</Empty>
                ) : (
                  <ul className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                    {blog.dropped.map((d, i) => (
                      <li key={i} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                        <span className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800">{d.keyword}</span>
                          <span className="text-xs text-slate-400 ml-2">{d.clientName}</span>
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {d.previous}위 → <span className="font-semibold text-red-500">{d.current ? `${d.current}위` : "미노출"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="새로 진입" note="직전 수집에서 7위 밖이었다가 들어온 키워드">
                {blog.entered.length === 0 ? (
                  <Empty>새로 진입한 키워드가 없습니다.</Empty>
                ) : (
                  <ul className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                    {blog.entered.map((d, i) => (
                      <li key={i} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                        <span className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800">{d.keyword}</span>
                          <span className="text-xs text-slate-400 ml-2">{d.clientName}</span>
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {d.previous ? `${d.previous}위` : "미노출"} → <span className="font-semibold text-emerald-600">{d.current}위</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            <Section title="병원별 요약" note="이름을 누르면 그 병원 화면으로 이동">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500">
                      <th className="px-5 py-2.5 text-left font-semibold">병원</th>
                      <th className="px-3 py-2.5 text-left font-semibold">담당</th>
                      <th className="px-3 py-2.5 text-right font-semibold">키워드</th>
                      <th className="px-3 py-2.5 text-right font-semibold">7위 이내</th>
                      <th className="px-3 py-2.5 text-right font-semibold">노출 중</th>
                      <th className="px-3 py-2.5 text-right font-semibold">이탈</th>
                      <th className="px-3 py-2.5 text-right font-semibold">진입</th>
                      <th className="px-5 py-2.5 text-right font-semibold">수집 빠짐</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {blog.clients.map((c) => (
                      <tr key={c.client.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                        <td className="px-5 py-2.5">
                          <button onClick={() => onSelectClient?.(c.client)} className="font-medium text-slate-800 hover:text-emerald-600 text-left">
                            {c.client.name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{c.client.assignee}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{c.total}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">{c.top}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{c.exposed}</td>
                        <td className={`px-3 py-2.5 text-right ${c.dropped ? "font-semibold text-red-500" : "text-slate-300"}`}>{c.dropped || "-"}</td>
                        <td className={`px-3 py-2.5 text-right ${c.entered ? "font-semibold text-emerald-600" : "text-slate-300"}`}>{c.entered || "-"}</td>
                        <td className={`px-5 py-2.5 text-right ${c.stale ? "font-semibold text-amber-600" : "text-slate-300"}`}>{c.stale || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}

        {mode === "cafe" && cafe && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="위닝 글" value={fmt(cafe.winning.length)} tone="good" sub="조회수 100 이상" />
              <Tile label="조회수 수집된 글" value={fmt(cafe.observedPosts)} sub={cafe.statsDate ? `${cafe.statsDate} 수집` : "아직 수집 전"} />
              <Tile
                label="검색 노출 중"
                value={fmt(cafe.clients.reduce((n, c) => n + c.exposed, 0))}
                sub={`전체 ${fmt(cafe.clients.reduce((n, c) => n + c.total, 0))}개 키워드`}
              />
              <Tile label="삭제된 글" value={fmt(cafe.clients.reduce((n, c) => n + c.deleted, 0))} tone="bad" sub="키워드 기준" />
            </div>

            <HealthSection mode="cafe" />

            <Section
              title="위닝 글"
              note={
                cafe.hasDelta
                  ? "글 조회수 100 이상 · 전날 대비 증가가 큰 순"
                  : "글 조회수 100 이상 · 누적 조회수 순 (전날 기록이 쌓이면 증가량 순으로 바뀝니다)"
              }
            >
              {cafe.statsError ? (
                <Empty>조회수 데이터를 불러오지 못했습니다: {cafe.statsError}</Empty>
              ) : cafe.winning.length === 0 ? (
                <Empty>조회수 100 이상인 글이 아직 없습니다.</Empty>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500">
                          <th className="px-5 py-2.5 text-left font-semibold">키워드 (검색 순위)</th>
                          <th className="px-3 py-2.5 text-left font-semibold">브랜드</th>
                          <th className="px-3 py-2.5 text-left font-semibold">카페</th>
                          <th className="px-3 py-2.5 text-right font-semibold">조회수</th>
                          <th className="px-3 py-2.5 text-right font-semibold">전날 대비</th>
                          <th className="px-3 py-2.5 text-right font-semibold">댓글</th>
                          <th className="px-5 py-2.5 text-right font-semibold">발행 후</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {(showAllWinning ? cafe.winning : cafe.winning.slice(0, 20)).map((w, i) => {
                          const age = daysSince(w.publishedAt);
                          return (
                            <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/60 align-top">
                              <td className="px-5 py-2.5">
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                  {w.keywords.map((k, j) => (
                                    <span key={j} className="whitespace-nowrap">
                                      <span className="font-medium text-slate-800">{k.keyword}</span>{" "}
                                      <span className={`text-xs ${k.rank ? "text-violet-600 font-semibold" : "text-slate-400"}`}>
                                        {k.isReply ? "꼬리글" : k.rank ? `${k.rank}위` : "미노출"}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                                {w.postUrl && (
                                  <a href={w.postUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-400 hover:text-violet-600 hover:underline">
                                    글 열기 ↗
                                  </a>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{w.clientName}</td>
                              <td className="px-3 py-2.5 text-slate-500">
                                <div className="truncate max-w-[140px]">{w.cafeName ?? "-"}</div>
                                {w.memberCount !== null && <div className="text-[11px] text-slate-400">회원 {fmt(w.memberCount)}</div>}
                              </td>
                              <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{fmt(w.readCount)}</td>
                              <td className={`px-3 py-2.5 text-right ${w.delta ? "font-semibold text-emerald-600" : "text-slate-300"}`}>
                                {w.delta !== null ? `+${fmt(w.delta)}` : "-"}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-500">{w.commentCount ?? "-"}</td>
                              <td className="px-5 py-2.5 text-right text-slate-500 whitespace-nowrap">
                                {age === null ? "-" : `${age}일`}
                                {age !== null && age <= 3 && <span className="ml-1 text-[11px] text-amber-600 font-medium">새 글</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {cafe.winning.length > 20 && (
                    <button onClick={() => setShowAllWinning((v) => !v)} className="w-full py-2.5 text-xs font-medium text-slate-500 hover:text-violet-600 border-t border-slate-100">
                      {showAllWinning ? "접기" : `나머지 ${cafe.winning.length - 20}건 더 보기`}
                    </button>
                  )}
                </>
              )}
            </Section>

            <Section title="브랜드별 요약" note="이름을 누르면 그 브랜드 화면으로 이동 · 조회수 비공개 = 카페 회원만 볼 수 있는 글">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500">
                      <th className="px-5 py-2.5 text-left font-semibold">브랜드</th>
                      <th className="px-3 py-2.5 text-right font-semibold">키워드</th>
                      <th className="px-3 py-2.5 text-right font-semibold">검색 노출</th>
                      <th className="px-3 py-2.5 text-right font-semibold">꼬리글</th>
                      <th className="px-3 py-2.5 text-right font-semibold">위닝 글</th>
                      <th className="px-3 py-2.5 text-right font-semibold">조회수 비공개</th>
                      <th className="px-5 py-2.5 text-right font-semibold">삭제</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {cafe.clients.map((c) => (
                      <tr key={c.client.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                        <td className="px-5 py-2.5">
                          <button onClick={() => onSelectClient?.(c.client)} className="font-medium text-slate-800 hover:text-violet-600 text-left">
                            {c.client.name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{c.total}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-violet-600">{c.exposed}</td>
                        <td className="px-3 py-2.5 text-right text-slate-500">{c.reply || "-"}</td>
                        <td className={`px-3 py-2.5 text-right ${c.winningPosts ? "font-semibold text-amber-600" : "text-slate-300"}`}>{c.winningPosts || "-"}</td>
                        <td className="px-3 py-2.5 text-right text-slate-500">{c.restrictedPosts || "-"}</td>
                        <td className={`px-5 py-2.5 text-right ${c.deleted ? "text-red-500" : "text-slate-300"}`}>{c.deleted || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </div>
    </main>
  );
}
