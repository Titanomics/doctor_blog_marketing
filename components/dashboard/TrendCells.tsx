"use client";

import Sparkline from "./Sparkline";
import { TREND_LABEL, type DayValue, type TrendStatus } from "@/lib/trend";
import type { KeywordPostStat } from "@/lib/cafePostStats";

export interface TrendInfo {
  days: DayValue[];
  status: TrendStatus;
  observed: number;
  topDays: number;
}

const STATUS_STYLE: Record<TrendStatus, string> = {
  top_hold: "bg-emerald-50 text-emerald-700 border-emerald-200",
  top_drop: "bg-red-50 text-red-600 border-red-200",
  long_unexposed: "bg-slate-100 text-slate-500 border-slate-200",
  insufficient: "bg-amber-50 text-amber-700 border-amber-200",
  none: "",
};

const STATUS_ICON: Record<TrendStatus, string> = {
  top_hold: "●",
  top_drop: "▼",
  long_unexposed: "–",
  insufficient: "?",
  none: "",
};

export function StatusBadge({ trend }: { trend: TrendInfo }) {
  if (trend.status === "none") return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${STATUS_STYLE[trend.status]}`}
      title={`최근 14일 중 수집 ${trend.observed}일, 그중 7위 이내 ${trend.topDays}일`}
    >
      <span aria-hidden>{STATUS_ICON[trend.status]}</span>
      {TREND_LABEL[trend.status]}
    </span>
  );
}

// 블로그 키워드 행: 30일 순위 미니 그래프 + 상태
export function TrendCell({ trend }: { trend: TrendInfo | undefined }) {
  if (!trend) return <span className="text-xs text-slate-300">-</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Sparkline days={trend.days} />
      <StatusBadge trend={trend} />
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 키워드의 최근 30일 검색량 (네이버 검색광고 API). pc/mobile: null = 값 없음, 0 = 10 미만
export interface VolumeInfo {
  pc: number | null;
  mobile: number | null;
  date: string;
  previous: { pc: number | null; mobile: number | null; date: string } | null;
}

export function volumeTotal(v: { pc: number | null; mobile: number | null } | null | undefined): number | null {
  if (!v || (v.pc === null && v.mobile === null)) return null;
  return (v.pc ?? 0) + (v.mobile ?? 0);
}

const fmtVolume = (n: number | null) => (n === null ? "-" : n === 0 ? "10 미만" : fmt(n));

// 키워드 이름 아래 한 줄: "검색 1,790/월 · 지난 조회 대비 +120"
export function VolumeLine({ volume }: { volume: VolumeInfo | undefined }) {
  if (!volume) return null;
  const total = volumeTotal(volume);
  if (total === null) {
    return <p className="text-[11px] font-normal text-slate-300 mt-0.5">검색량 정보 없음</p>;
  }
  const prev = volumeTotal(volume.previous);
  const diff = prev !== null ? total - prev : null;
  return (
    <p
      className="text-[11px] font-normal text-slate-400 mt-0.5 tabular-nums whitespace-nowrap"
      title={`최근 30일 검색량 (${volume.date} 조회) — PC ${fmtVolume(volume.pc)} · 모바일 ${fmtVolume(volume.mobile)}`}
    >
      검색 <span className="font-semibold text-slate-600">{total === 0 ? "20 미만" : fmt(total)}</span>/월
      {diff !== null && diff !== 0 && (
        <span className={diff > 0 ? "text-emerald-600" : "text-red-400"}>
          {" "}
          ({diff > 0 ? "+" : ""}
          {fmt(diff)})
        </span>
      )}
    </p>
  );
}

// 카페 키워드 행: 글 조회수(누적) + 전날 대비 증가 + 위닝 표시
export function ViewCell({ stat }: { stat: KeywordPostStat | undefined }) {
  if (!stat) return <span className="text-xs text-slate-300">-</span>;
  if (stat.deleted) return <span className="text-xs text-slate-300">-</span>;
  if (stat.restricted) {
    return (
      <span className="text-[11px] text-slate-400" title="카페 회원만 볼 수 있는 글이라 조회수를 확인할 수 없습니다">
        🔒 비공개
      </span>
    );
  }
  if (stat.readCount === null) return <span className="text-xs text-slate-300">-</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 tabular-nums">
      <span>
        조회 <span className="text-sm font-semibold text-slate-700">{fmt(stat.readCount)}</span>
      </span>
      {stat.winning && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 font-bold whitespace-nowrap">
          ★ 위닝
        </span>
      )}
      {stat.delta !== null ? (
        <span className={stat.delta > 0 ? "text-emerald-600 font-medium" : ""}>전날 대비 +{fmt(stat.delta)}</span>
      ) : (
        <span>전날 기록 없음</span>
      )}
      {stat.commentCount !== null && <span>댓글 {fmt(stat.commentCount)}</span>}
    </div>
  );
}
