"use client";

import { useEffect, useState } from "react";

// 미노출 키워드 자동 확인.
// 우리 글이 안 뜨는 키워드마다 "그 검색 결과에 우리 제품 글이 있긴 한가"를 매일 새벽 확인한 결과.
// 자리를 차지한 다른 글은 보여주지 않는다 — 있음/없음과 있을 때의 순위만.

type Side = "cafe" | "reporter";

interface Found {
  keyword: string;
  sides: Side[];
  bestRank: number | null;
  registered: boolean;
  registeredBrand: string | null;
  mentionLevel: string | null;
  title: string | null;
  link: string | null;
  newlyFound: boolean;
}

interface Plain {
  keyword: string;
  sides: Side[];
}

interface AutoScanResponse {
  date: string | null;
  found: Found[];
  none: Plain[];
  unreadable: Plain[];
}

const LEVEL_TEXT: Record<string, string> = { main: "제품 글", switch: "전환형 글", light: "짧은 추천", comment_only: "댓글 언급" };

function sideText(sides: Side[]) {
  if (sides.length === 2) return "카페·기자단";
  return sides[0] === "cafe" ? "카페" : "기자단";
}

export default function AutoScanSection() {
  const [data, setData] = useState<AutoScanResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [showNone, setShowNone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mention-scan/auto", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: AutoScanResponse) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = data ? data.found.length + data.none.length + data.unreadable.length : 0;

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-slate-800">미노출 키워드 제품 글 확인</h2>
        <span className="text-[11px] text-slate-400">
          우리 글이 안 뜨는 키워드마다 검색 결과에 제품 글(등록된 우리 글 또는 제품을 알리는 언급 글)이 있는지 매일 새벽 확인
          {data?.date ? ` · ${data.date}` : ""}
        </span>
      </div>

      {failed && <div className="px-5 py-5 text-sm text-slate-400">불러오지 못했습니다.</div>}
      {!data && !failed && <div className="px-5 py-5 text-sm text-slate-400">불러오는 중...</div>}
      {data && total === 0 && <div className="px-5 py-5 text-sm text-slate-400">아직 자동 확인 결과가 없습니다. 다음 새벽 배치부터 쌓입니다.</div>}

      {data && total > 0 && (
        <>
          <div className="px-5 py-3 flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
            <span className="text-slate-500">
              확인 <b className="text-slate-800">{total}</b>개 키워드
            </span>
            <span className="text-violet-700">
              있음 <b>{data.found.length}</b>
            </span>
            <span className="text-slate-500">
              없음 <b>{data.none.length}</b>
            </span>
            {data.unreadable.length > 0 && (
              <span className="text-amber-600" title="상위 글의 본문을 하나도 읽지 못해 판단할 수 없음 (회원 전용 카페 글 등)">
                본문 확인 불가 <b>{data.unreadable.length}</b>
              </span>
            )}
          </div>

          {data.found.length > 0 && (
            <div className="overflow-x-auto border-t border-slate-50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="px-5 py-2 text-left font-semibold">키워드</th>
                    <th className="px-3 py-2 text-left font-semibold">미노출인 쪽</th>
                    <th className="px-3 py-2 text-right font-semibold">제품 글 순위</th>
                    <th className="px-3 py-2 text-left font-semibold">어떤 글</th>
                    <th className="px-5 py-2 text-left font-semibold">제목</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.found.map((v) => (
                    <tr key={v.keyword} className="border-t border-slate-50">
                      <td className="px-5 py-2 text-slate-800 font-medium whitespace-nowrap">
                        {v.keyword}
                        {v.newlyFound && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border border-violet-200 bg-violet-50 text-violet-700">
                            새로 확인
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{sideText(v.sides)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-violet-700">{v.bestRank}위</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {v.registered ? (
                          <span className="px-1.5 py-0.5 text-[11px] font-semibold rounded border border-violet-600 bg-violet-600 text-white">
                            우리 등록 글{v.registeredBrand ? ` · ${v.registeredBrand}` : ""}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[11px] font-medium rounded border border-slate-200 bg-slate-50 text-slate-600">
                            미등록 · {LEVEL_TEXT[v.mentionLevel ?? ""] ?? "언급 글"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2 text-slate-600 max-w-[320px] truncate">
                        {v.link ? (
                          <a href={v.link} target="_blank" rel="noreferrer" className="hover:text-violet-600 hover:underline" title={v.title ?? ""}>
                            {v.title}
                          </a>
                        ) : (
                          v.title
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(data.none.length > 0 || data.unreadable.length > 0) && (
            <div className="px-5 py-3 border-t border-slate-50 text-xs">
              <button className="text-slate-500 hover:text-slate-800 underline underline-offset-2" onClick={() => setShowNone((v) => !v)}>
                {showNone ? "없음 목록 접기" : `제품 글 없음 ${data.none.length}개${data.unreadable.length ? ` · 확인 불가 ${data.unreadable.length}개` : ""} 펼치기`}
              </button>
              {showNone && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.none.map((v) => (
                    <span key={v.keyword} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600" title={sideText(v.sides)}>
                      {v.keyword}
                    </span>
                  ))}
                  {data.unreadable.map((v) => (
                    <span key={v.keyword} className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700" title={`${sideText(v.sides)} · 본문 확인 불가`}>
                      {v.keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
