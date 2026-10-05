"use client";

import type { DayValue } from "@/lib/trend";

// 표 안에 들어가는 30일 순위 미니 그래프.
// - 세로축은 모든 행이 같다: 1위(위) ~ MAX_RANK위(아래). 행마다 확대하지 않는다.
// - 미노출(0)은 맨 아래 줄에 옅은 점으로, 수집 기록이 없는 날(null)은 비워 두고 선을 끊는다.
// - 맨 위 옅은 띠가 7위 이내 구간.

const W = 120;
const H = 28;
const PAD = 3;
const MAX_RANK = 30;
const TOP_RANK = 7;

const y = (rank: number) => PAD + ((Math.min(rank, MAX_RANK) - 1) / (MAX_RANK - 1)) * (H - PAD * 2 - 4);

export default function Sparkline({
  days,
  accent = "#10b981",
  label,
}: {
  days: DayValue[];
  accent?: string;
  label?: string;
}) {
  const n = days.length;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));

  // 연속으로 순위가 있는 구간마다 선 하나
  const segments: string[] = [];
  let current: string[] = [];
  days.forEach((v, i) => {
    if (v !== null && v > 0) {
      current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    } else if (current.length) {
      segments.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) segments.push(current.join(" "));

  let lastIndex = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (days[i] !== null) {
      lastIndex = i;
      break;
    }
  }
  const last = lastIndex >= 0 ? days[lastIndex] : null;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label ?? "최근 30일 순위 추이"}
      className="block"
    >
      <rect x={0} y={0} width={W} height={y(TOP_RANK) + 1} rx={2} fill={accent} opacity={0.08} />
      {days.map((v, i) =>
        v === 0 ? <circle key={i} cx={x(i)} cy={H - 3} r={1} fill="#cbd5e1" /> : null
      )}
      {segments.map((points, i) =>
        points.includes(" ") ? (
          <polyline
            key={i}
            points={points}
            fill="none"
            stroke={accent}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <circle key={i} cx={points.split(",")[0]} cy={points.split(",")[1]} r={1.5} fill={accent} />
        )
      )}
      {last !== null && last > 0 && (
        <circle cx={x(lastIndex)} cy={y(last)} r={2.5} fill={accent} stroke="#fff" strokeWidth={1} />
      )}
    </svg>
  );
}
