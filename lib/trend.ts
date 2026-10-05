// 일별 순위 배열로 키워드 상태를 분류한다 (네트워크·DB 없음).
//
// 하루 값: 양수 = 그날 순위 / 0 = 수집했으나 미노출 / null = 그날 수집 기록 없음
// 순위는 PC 통합검색 화면의 전체 순서 기준.

export type DayValue = number | null;

export type TrendStatus =
  | "top_hold" // 상위권 유지
  | "top_drop" // 상위권 이탈
  | "long_unexposed" // 장기 미노출
  | "insufficient" // 관측 부족
  | "none";

export const TOP_RANK = 7;
const WINDOW_DAYS = 14;
const MIN_OBSERVED = 10;
const HOLD_RATIO = 0.8;

export const TREND_LABEL: Record<TrendStatus, string> = {
  top_hold: "상위권 유지",
  top_drop: "상위권 이탈",
  long_unexposed: "장기 미노출",
  insufficient: "관측 부족",
  none: "",
};

const isTop = (v: DayValue) => v !== null && v >= 1 && v <= TOP_RANK;

export interface TrendSummary {
  status: TrendStatus;
  observed: number; // 최근 14일 중 수집 기록이 있는 날
  topDays: number; // 그중 7위 이내였던 날
}

// days: 오래된 날 → 최근 날 순서
export function classifyTrend(days: DayValue[]): TrendSummary {
  const recent = days.slice(-WINDOW_DAYS).filter((v) => v !== null);
  const observed = recent.length;
  const topDays = recent.filter(isTop).length;

  if (observed < MIN_OBSERVED) return { status: "insufficient", observed, topDays };

  const allObserved = days.filter((v) => v !== null);
  if (allObserved.every((v) => v === 0)) return { status: "long_unexposed", observed, topDays };

  if (topDays / observed >= HOLD_RATIO) return { status: "top_hold", observed, topDays };

  // 이탈: 가장 최근 관측은 상위권이 아닌데, 직전 7번의 관측 안에 상위권이 3번 이상 있었음
  const latest = recent[recent.length - 1];
  const before = recent.slice(-8, -1);
  if (!isTop(latest) && before.filter(isTop).length >= 3) {
    return { status: "top_drop", observed, topDays };
  }

  return { status: "none", observed, topDays };
}

// KST 기준 최근 n일의 날짜 문자열 (오래된 날 → 오늘)
export function recentKstDates(n: number, nowMs: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(nowMs + 9 * 3600_000 - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

// history 행들을 날짜 배열에 맞춘 DayValue 배열로 변환
export function toDayValues(
  dates: string[],
  rows: { tracked_date: string; rank: number | null }[]
): DayValue[] {
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.tracked_date, r.rank ?? 0);
  return dates.map((d) => (byDate.has(d) ? byDate.get(d)! : null));
}
