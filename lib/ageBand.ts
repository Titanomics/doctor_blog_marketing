// 발행일 기준 "주차 띠"와 노출 사건 계산 (네트워크·DB 없음).
//
// 주차: 발행일(KST) D+0~6 = 1주차, D+7~13 = 2주차 …
// 띠의 한 칸 = 그 7일 동안 "유효하게 수집한 날" 중 "노출된 날" 수.
// 띠는 주간 집계일 뿐이므로, 첫 노출·재진입·이탈 같은 사건은 띠가 아니라 일별 기록으로 따로 판정한다.

export interface DayRecord {
  date: string; // YYYY-MM-DD (KST)
  rank: number | null; // null = 수집했으나 미노출
}

export type CellState =
  | "future" // 아직 오지 않은 주
  | "no_data" // 지났지만 유효한 수집 기록이 없음
  | "none" // 수집했고 노출 0일
  | "partial" // 일부 날만 노출 (절반 미만)
  | "full"; // 수집한 날의 절반 이상 노출

export interface WeekCell {
  week: number; // 1부터
  state: CellState;
  observedDays: number;
  exposedDays: number;
}

export type ExposureEvent =
  | "first" // 처음 노출 확인 (발행 초기부터 수집 기록이 있음)
  | "first_seen" // 수집을 시작한 뒤 처음 노출 확인 (그 전 상태는 모름)
  | "reentry" // 내려갔다가 다시 노출
  | "drop"; // 노출되다가 내려감

export interface AgeSummary {
  ageDays: number; // 발행 후 지난 날 수 (오늘 = 발행일이면 0)
  week: number; // 현재 주차
  cells: WeekCell[]; // 1주차부터 현재 주차까지
  observedSince: string | null; // 유효 수집이 시작된 날
  observedFromStart: boolean; // 발행 후 7일 안에 수집이 시작됐는지
  firstExposureDate: string | null;
  firstExposureWeek: number | null;
  everExposed: boolean;
  todayEvent: ExposureEvent | null; // 가장 최근 수집일에 일어난 사건
  latestDate: string | null; // 가장 최근 유효 수집일
  latestRank: number | null;
}

// 이 날짜부터는 수집 실패를 "미노출"로 기록하지 않는다 (실패는 기록 자체를 남기지 않음).
// 그 전 기록의 "앞뒤 날은 노출인데 하루만 미노출"은 수집 실패로 보고 유효 수집에서 뺀다.
export const FAILURE_SEPARATED_FROM = "2026-10-06";

const DAY_MS = 86_400_000;
const toDay = (date: string) => Math.round(new Date(`${date}T00:00:00Z`).getTime() / DAY_MS);

// 수집 실패로 의심되는 과거 기록을 걸러낸 "유효 수집" 목록 (날짜 오름차순)
export function validRecords(records: DayRecord[]): DayRecord[] {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.filter((r, i) => {
    if (r.rank !== null || r.date >= FAILURE_SEPARATED_FROM) return true;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    // 바로 앞뒤(사흘 이내)가 모두 노출일 때만 실패로 본다. 수집 공백을 사이에 둔 기록은 판단하지 않는다.
    const blip =
      !!prev && !!next && prev.rank !== null && next.rank !== null && toDay(next.date) - toDay(prev.date) <= 3;
    return !blip;
  });
}

export function summarizeAge(publishedDate: string, records: DayRecord[], today: string): AgeSummary {
  const pub = toDay(publishedDate);
  const ageDays = Math.max(0, toDay(today) - pub);
  const week = Math.floor(ageDays / 7) + 1;
  // 발행 전 날짜의 기록(같은 키워드에 다른 글이 걸려 있던 시절)은 이 글의 기록이 아니다
  const valid = validRecords(records).filter((r) => toDay(r.date) >= pub && r.date <= today);

  const cells: WeekCell[] = [];
  for (let w = 1; w <= week; w++) {
    const start = pub + (w - 1) * 7;
    const inWeek = valid.filter((r) => {
      const d = toDay(r.date);
      return d >= start && d < start + 7;
    });
    const observedDays = inWeek.length;
    const exposedDays = inWeek.filter((r) => r.rank !== null).length;
    const state: CellState =
      observedDays === 0 ? "no_data" : exposedDays === 0 ? "none" : exposedDays * 2 >= observedDays ? "full" : "partial";
    cells.push({ week: w, state, observedDays, exposedDays });
  }

  const observedSince = valid[0]?.date ?? null;
  const observedFromStart = observedSince !== null && toDay(observedSince) - pub <= 7;
  const firstExposure = valid.find((r) => r.rank !== null) ?? null;
  const firstExposureWeek = firstExposure ? Math.floor((toDay(firstExposure.date) - pub) / 7) + 1 : null;

  const latest = valid[valid.length - 1] ?? null;
  const before = valid[valid.length - 2] ?? null;
  let todayEvent: ExposureEvent | null = null;
  // 사건은 "그 전 수집과 비교해 달라진 것"이다. 수집이 하루뿐이면 비교할 대상이 없다.
  if (latest && before) {
    const exposedBefore = valid.slice(0, -1).some((r) => r.rank !== null);
    if (latest.rank !== null) {
      if (!exposedBefore) todayEvent = observedFromStart ? "first" : "first_seen";
      else if (before.rank === null) todayEvent = "reentry";
    } else if (before.rank !== null) {
      todayEvent = "drop";
    }
  }

  return {
    ageDays,
    week,
    cells,
    observedSince,
    observedFromStart,
    firstExposureDate: firstExposure?.date ?? null,
    firstExposureWeek,
    everExposed: !!firstExposure,
    todayEvent,
    latestDate: latest?.date ?? null,
    latestRank: latest?.rank ?? null,
  };
}

// 발행 후 점검일(7·14·21·28일째)에 해당하는지
export const CHECKPOINT_DAYS = [7, 14, 21, 28];
export function checkpointOf(ageDays: number): number | null {
  return CHECKPOINT_DAYS.includes(ageDays) ? ageDays : null;
}

// 발행 주(월요일 시작)의 첫날 — 발행 묶음별 표의 행 기준
export function publishWeekStart(publishedDate: string): string {
  const d = new Date(`${publishedDate}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}
