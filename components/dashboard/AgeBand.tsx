"use client";

// 발행 주차 띠. 한 칸 = 발행일부터 센 1주(7일).
//   ● 그 주에 수집한 날의 절반 이상 노출   ◐ 일부 날만 노출   ○ 수집했는데 노출 없음
//   · 지났지만 수집 기록 없음              (빈칸) 아직 오지 않은 주
// 띠는 주간 집계다. "언제 처음 떴는지"는 옆의 글자로 따로 적는다.

export interface WeekCell {
  week: number;
  state: "future" | "no_data" | "none" | "partial" | "full";
  observedDays: number;
  exposedDays: number;
}

export interface AgeInfo {
  publishedDate: string;
  estimated: boolean;
  ageDays: number;
  week: number;
  cells: WeekCell[];
  firstWeek: number;
  observedSince: string | null;
  observedFromStart: boolean;
  firstExposureDate: string | null;
  firstExposureWeek: number | null;
  everExposed: boolean;
  lateFirst: boolean;
  todayEvent: "first" | "first_seen" | "reentry" | "drop" | null;
  latestDate: string | null;
  latestRank: number | null;
  checkpoint: number | null;
  needsCheck: boolean;
}

const EVENT_LABEL: Record<NonNullable<AgeInfo["todayEvent"]>, string> = {
  first: "오늘 처음 노출",
  first_seen: "수집 시작 후 첫 노출 확인",
  reentry: "다시 노출",
  drop: "노출에서 내려감",
};

function Cell({ cell, accent }: { cell: WeekCell; accent: string }) {
  const size = 12;
  const title =
    cell.state === "no_data"
      ? `${cell.week}주차: 수집 기록 없음`
      : `${cell.week}주차: 노출 ${cell.exposedDays}일 / 수집 ${cell.observedDays}일`;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" role="img" aria-label={title}>
      <title>{title}</title>
      {cell.state === "full" && <circle cx={6} cy={6} r={5} fill={accent} />}
      {cell.state === "partial" && (
        <>
          <circle cx={6} cy={6} r={4.5} fill="none" stroke={accent} strokeWidth={1} />
          <path d="M6 1.5 A4.5 4.5 0 0 0 6 10.5 Z" fill={accent} />
        </>
      )}
      {cell.state === "none" && <circle cx={6} cy={6} r={4.5} fill="none" stroke="#94a3b8" strokeWidth={1} />}
      {cell.state === "no_data" && <circle cx={6} cy={6} r={1.5} fill="#cbd5e1" />}
    </svg>
  );
}

export default function AgeBand({ age, accent = "#8b5cf6" }: { age: AgeInfo | undefined; accent?: string }) {
  if (!age) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-normal text-slate-500">
      <span
        className="font-semibold text-slate-700 whitespace-nowrap"
        title={`${age.estimated ? "발행일을 알 수 없어 등록일 기준" : "발행일"} ${age.publishedDate} · 발행 ${age.ageDays}일째`}
      >
        발행 {age.week}주차{age.estimated ? "*" : ""}
      </span>
      <span className="inline-flex items-center gap-0.5" aria-label="주차별 노출">
        {age.firstWeek > 1 && <span className="text-slate-300 mr-0.5">…</span>}
        {age.cells.map((c) => (
          <Cell key={c.week} cell={c} accent={accent} />
        ))}
      </span>
      {age.firstExposureWeek !== null && age.observedFromStart ? (
        <span className={`whitespace-nowrap ${age.lateFirst ? "font-semibold text-violet-700" : ""}`}>
          {age.firstExposureWeek}주차에 처음 노출
        </span>
      ) : age.firstExposureWeek !== null ? (
        <span className="whitespace-nowrap text-slate-400" title="수집을 시작하기 전에 떠 있었는지는 알 수 없습니다">
          수집 시작({age.observedSince?.slice(5).replace("-", "/")}) 후 노출 확인
        </span>
      ) : age.needsCheck ? (
        <span className="whitespace-nowrap font-medium text-amber-600">노출 확인 없음 · 점검 대상</span>
      ) : null}
      {age.todayEvent && (
        <span
          className={`px-1.5 py-0.5 rounded border whitespace-nowrap font-semibold ${
            age.todayEvent === "drop" ? "border-red-200 bg-red-50 text-red-600" : "border-violet-200 bg-violet-50 text-violet-700"
          }`}
        >
          {EVENT_LABEL[age.todayEvent]}
        </span>
      )}
      {age.checkpoint && <span className="whitespace-nowrap text-slate-400">오늘 발행 {age.checkpoint}일째</span>}
    </div>
  );
}
