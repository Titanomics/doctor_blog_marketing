"use client";

import { useMemo, useRef, useState } from "react";

// 키워드 한 개의 일별 순위 꺾은선 그래프.
// - 세로축은 위가 1위. 7위 이내 구간을 옅은 띠로 표시.
// - 미노출인 날은 맨 아래 "미노출" 줄에 점으로, 수집 기록이 없는 날은 비워 두고 선을 끊는다.
// - 마우스를 올리면 그 날짜의 값을 보여준다.

export interface RankPoint {
  date: string; // YYYY-MM-DD (KST)
  rank: number | null; // null = 미노출
}

const W = 720;
const H = 240;
const M = { top: 12, right: 16, bottom: 26, left: 44 };
const TOP_RANK = 7;

function formatDay(date: string) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function RankChart({
  dates,
  points,
  accent = "#10b981",
}: {
  dates: string[]; // 표시할 전체 기간 (오래된 날 → 최근)
  points: RankPoint[]; // 수집 기록이 있는 날만
  accent?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const byDate = useMemo(() => new Map(points.map((p) => [p.date, p.rank])), [points]);
  const ranks = points.map((p) => p.rank).filter((r): r is number => r !== null);
  const maxRank = Math.max(10, Math.min(50, Math.ceil(Math.max(TOP_RANK, ...ranks) / 5) * 5));

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const unexposedY = M.top + plotH; // 미노출 줄
  const rankBottom = unexposedY - 22; // 순위 축의 가장 아래
  const x = (i: number) => M.left + (dates.length <= 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = (rank: number) => M.top + ((Math.min(rank, maxRank) - 1) / (maxRank - 1)) * (rankBottom - M.top);

  const segments: string[] = [];
  let current: string[] = [];
  dates.forEach((d, i) => {
    const r = byDate.get(d);
    if (typeof r === "number") {
      current.push(`${x(i).toFixed(1)},${y(r).toFixed(1)}`);
    } else if (current.length) {
      segments.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) segments.push(current.join(" "));

  const yTicks = [1, TOP_RANK, ...[10, 20, 30, 40, 50].filter((t) => t <= maxRank && t > TOP_RANK)];
  const step = Math.max(1, Math.round(dates.length / 6));
  const xTicks = dates.map((_, i) => i).filter((i) => i % step === 0 || i === dates.length - 1);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - M.left) / plotW) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  };

  const hoverDate = hover !== null ? dates[hover] : null;
  const hoverHas = hoverDate !== null && byDate.has(hoverDate);
  const hoverRank = hoverHas ? byDate.get(hoverDate!) ?? null : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label="일별 순위 추이 그래프"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* 7위 이내 구간 */}
        <rect x={M.left} y={M.top} width={plotW} height={y(TOP_RANK) - M.top} fill={accent} opacity={0.07} />

        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#94a3b8">
              {t}위
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={unexposedY} y2={unexposedY} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3 3" />
        <text x={M.left - 8} y={unexposedY + 4} textAnchor="end" fontSize={11} fill="#94a3b8">
          미노출
        </text>

        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="#94a3b8">
            {formatDay(dates[i])}
          </text>
        ))}

        {/* 미노출인 날 */}
        {dates.map((d, i) =>
          byDate.has(d) && byDate.get(d) === null ? (
            <circle key={d} cx={x(i)} cy={unexposedY} r={2.5} fill="#cbd5e1" />
          ) : null
        )}

        {segments.map((pts, i) =>
          pts.includes(" ") ? (
            <polyline key={i} points={pts} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <circle key={i} cx={pts.split(",")[0]} cy={pts.split(",")[1]} r={3} fill={accent} />
          )
        )}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={unexposedY} stroke="#94a3b8" strokeWidth={1} />
            {hoverHas && (
              <circle
                cx={x(hover)}
                cy={hoverRank !== null ? y(hoverRank) : unexposedY}
                r={4.5}
                fill={hoverRank !== null ? accent : "#94a3b8"}
                stroke="#fff"
                strokeWidth={2}
              />
            )}
          </g>
        )}
      </svg>

      {hover !== null && hoverDate && (
        <div
          className="absolute top-1 pointer-events-none bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: hover > dates.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <span className="text-slate-300">{hoverDate}</span>{" "}
          <span className="font-semibold">
            {!hoverHas ? "수집 기록 없음" : hoverRank !== null ? `${hoverRank}위` : "미노출"}
          </span>
        </div>
      )}
    </div>
  );
}
