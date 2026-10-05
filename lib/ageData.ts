// 카페 키워드 · 블로그기자단 글의 "발행 주차" 정보 (주차 띠, 첫 노출, 오늘의 사건).
// 대시보드(/api/age)와 슬랙 알림이 함께 쓴다.

import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";
import { checkpointOf, summarizeAge, type AgeSummary, type DayRecord, type WeekCell } from "@/lib/ageBand";

export type AgeMode = "cafe" | "reporter";

const HISTORY: Record<AgeMode, { table: string; idColumn: string }> = {
  cafe: { table: "cafe_keyword_history", idColumn: "keyword_id" },
  reporter: { table: "reporter_blog_history", idColumn: "entry_id" },
};

export interface AgeSource {
  id: string; // 카페: cafe_keywords.id / 기자단: reporter_blog_entries.id
  published_at: string | null;
  created_at: string | null;
}

export interface AgeInfo {
  publishedDate: string; // KST
  estimated: boolean; // 발행일을 알 수 없어 대시보드 등록일로 대신함
  ageDays: number;
  week: number;
  cells: WeekCell[]; // 화면용: 최근 8주만
  firstWeek: number; // cells[0] 이 몇 주차인지
  observedSince: string | null;
  observedFromStart: boolean;
  firstExposureDate: string | null;
  firstExposureWeek: number | null;
  everExposed: boolean;
  lateFirst: boolean; // 발행 초기부터 수집했고, 2주차 이후에 처음 노출됨
  todayEvent: AgeSummary["todayEvent"];
  latestDate: string | null;
  latestRank: number | null;
  checkpoint: number | null; // 오늘이 발행 7·14·21·28일째면 그 숫자
  needsCheck: boolean; // 발행 7일 경과 · 초기부터 수집 · 노출 확인 없음
}

const DISPLAY_WEEKS = 8;

export function toAgeInfo(publishedDate: string, estimated: boolean, records: DayRecord[], today: string): AgeInfo {
  const s = summarizeAge(publishedDate, records, today);
  const cells = s.cells.slice(-DISPLAY_WEEKS);
  return {
    publishedDate,
    estimated,
    ageDays: s.ageDays,
    week: s.week,
    cells,
    firstWeek: cells[0]?.week ?? 1,
    observedSince: s.observedSince,
    observedFromStart: s.observedFromStart,
    firstExposureDate: s.firstExposureDate,
    firstExposureWeek: s.firstExposureWeek,
    everExposed: s.everExposed,
    lateFirst: s.observedFromStart && s.firstExposureWeek !== null && s.firstExposureWeek >= 2,
    todayEvent: s.todayEvent,
    latestDate: s.latestDate,
    latestRank: s.latestRank,
    checkpoint: checkpointOf(s.ageDays),
    needsCheck: s.ageDays >= 7 && s.observedFromStart && !s.everExposed,
  };
}

// sources 의 각 항목에 대해 발행 주차 정보를 만든다. 발행일도 등록일도 없으면 결과에 넣지 않는다.
export async function loadAgeInfo(mode: AgeMode, sources: AgeSource[]): Promise<{ today: string; items: Map<string, AgeInfo>; error: string | null }> {
  const today = getKSTDateString();
  const { table, idColumn } = HISTORY[mode];
  const items = new Map<string, AgeInfo>();

  const dated = sources
    .map((s) => {
      const base = s.published_at ?? s.created_at;
      return base ? { id: s.id, date: getKSTDateString(new Date(base)), estimated: !s.published_at } : null;
    })
    .filter((x): x is { id: string; date: string; estimated: boolean } => x !== null);
  if (dated.length === 0) return { today, items, error: null };

  // 가장 이른 발행일 이후의 이력만 읽는다
  const earliest = dated.reduce((min, d) => (d.date < min ? d.date : min), dated[0].date);
  const byId = new Map<string, DayRecord[]>();
  let error: string | null = null;

  const ids = dated.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const result = await fetchAll<Record<string, string | number | null>>((from, to) =>
      supabase
        .from(table)
        .select("*") // 열 이름이 표마다 달라(keyword_id / entry_id) 문자열 조합 대신 전체를 읽는다
        .in(idColumn, part)
        .gte("tracked_date", earliest)
        .order("tracked_date", { ascending: true })
        .order(idColumn, { ascending: true })
        .range(from, to)
    );
    if (result.error) error = result.error;
    for (const row of result.data) {
      const id = row[idColumn] as string;
      const rec = { date: row.tracked_date as string, rank: row.rank as number | null };
      const list = byId.get(id);
      if (list) list.push(rec);
      else byId.set(id, [rec]);
    }
  }

  for (const d of dated) items.set(d.id, toAgeInfo(d.date, d.estimated, byId.get(d.id) ?? [], today));
  return { today, items, error };
}
