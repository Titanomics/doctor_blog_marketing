// 수집 상태 요약. 수집 상태 화면(/api/health)과 슬랙 알림이 함께 쓴다.
//
// 별도의 실행 기록 테이블 없이 데이터에서 직접 읽는다:
// - 최근 수집일 = 가장 최근 updated_at 의 KST 날짜
// - 수집됨/빠짐 = 그날 갱신된 행 수 / 그렇지 않은 행 수
// - 실패 = collect_failures 에 그날 기록된 것

import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";
import { FAILURE_LABEL, type CollectMode, type FailureKind } from "@/lib/collectFailures";
import { recentKstDates } from "@/lib/trend";

const SOURCES: Record<
  CollectMode,
  { label: string; table: string; history: string; keywordTable: string; clientTable: string }
> = {
  blog: { label: "블로그", table: "keywords", history: "keyword_history", keywordTable: "keywords", clientTable: "clients" },
  cafe: { label: "카페", table: "cafe_keywords", history: "cafe_keyword_history", keywordTable: "cafe_keywords", clientTable: "cafe_clients" },
  // 기자단은 키워드 아래 등록된 글 단위로 순위를 저장한다
  reporter: { label: "기자단", table: "reporter_blog_entries", history: "reporter_blog_history", keywordTable: "reporter_keywords", clientTable: "cafe_clients" },
};

export interface FailureItem {
  keyword: string;
  clientName: string;
  kind: FailureKind;
  kindLabel: string;
  detail: string | null;
  occurredAt: string;
}

export interface ModeHealth {
  mode: CollectMode;
  label: string;
  total: number;
  latestDate: string | null; // 가장 최근 수집일 (KST)
  isToday: boolean;
  collected: number; // 최근 수집일에 갱신된 수
  stale: number; // 최근 수집일에 갱신되지 않은 수
  firstAt: string | null; // 그날 첫 갱신 시각
  lastAt: string | null; // 그날 마지막 갱신 시각
  failures: {
    available: boolean; // collect_failures 테이블을 읽을 수 있는지
    events: number; // 실패 기록 수
    keywords: number; // 실패한 키워드 수 (중복 제거)
    byKind: Partial<Record<FailureKind, number>>;
    items: FailureItem[];
  };
  coverage: { date: string; rows: number }[]; // 최근 14일 날짜별 이력 저장 건수
}

export async function loadModeHealth(mode: CollectMode): Promise<ModeHealth> {
  const src = SOURCES[mode];
  const today = getKSTDateString();

  const rows = await fetchAll<{ updated_at: string | null }>((from, to) =>
    supabase.from(src.table).select("updated_at").order("id", { ascending: true }).range(from, to)
  );

  let latestAt: string | null = null;
  for (const r of rows.data) if (r.updated_at && (!latestAt || r.updated_at > latestAt)) latestAt = r.updated_at;
  const latestDate = latestAt ? getKSTDateString(new Date(latestAt)) : null;

  let collected = 0;
  let firstAt: string | null = null;
  for (const r of rows.data) {
    if (r.updated_at && getKSTDateString(new Date(r.updated_at)) === latestDate) {
      collected++;
      if (!firstAt || r.updated_at < firstAt) firstAt = r.updated_at;
    }
  }

  // 실패 기록 (최근 수집일 기준)
  const failures: ModeHealth["failures"] = { available: true, events: 0, keywords: 0, byKind: {}, items: [] };
  if (latestDate) {
    const { data, error } = await supabase
      .from("collect_failures")
      .select("keyword_id, kind, detail, occurred_at")
      .eq("kst_date", latestDate)
      .eq("mode", mode)
      .order("occurred_at", { ascending: false })
      .limit(1000);
    if (error) {
      failures.available = false;
    } else {
      const events = data ?? [];
      failures.events = events.length;
      // 키워드별 가장 최근 실패 하나만 남긴다
      const latestByKeyword = new Map<string, (typeof events)[number]>();
      for (const e of events) if (e.keyword_id && !latestByKeyword.has(e.keyword_id)) latestByKeyword.set(e.keyword_id, e);
      failures.keywords = latestByKeyword.size;
      for (const e of latestByKeyword.values()) {
        const kind = e.kind as FailureKind;
        failures.byKind[kind] = (failures.byKind[kind] ?? 0) + 1;
      }

      const ids = [...latestByKeyword.keys()].slice(0, 50);
      if (ids.length > 0) {
        const { data: kws } = await supabase.from(src.keywordTable).select("id, keyword, client_id").in("id", ids);
        const { data: clients } = await supabase.from(src.clientTable).select("id, name");
        const clientName = new Map((clients ?? []).map((c) => [c.id, c.name as string]));
        const byId = new Map((kws ?? []).map((k) => [k.id, k]));
        for (const id of ids) {
          const e = latestByKeyword.get(id)!;
          const kw = byId.get(id);
          if (!kw) continue; // 그 사이 삭제된 키워드
          const kind = e.kind as FailureKind;
          failures.items.push({
            keyword: kw.keyword,
            clientName: clientName.get(kw.client_id) ?? "",
            kind,
            kindLabel: FAILURE_LABEL[kind] ?? kind,
            detail: e.detail,
            occurredAt: e.occurred_at,
          });
        }
      }
    }
  }

  // 최근 14일 날짜별 이력 건수
  const dates = recentKstDates(14);
  const coverage = await Promise.all(
    dates.map(async (date) => {
      const { count } = await supabase.from(src.history).select("id", { count: "exact", head: true }).eq("tracked_date", date);
      return { date, rows: count ?? 0 };
    })
  );

  return {
    mode,
    label: src.label,
    total: rows.data.length,
    latestDate,
    isToday: latestDate === today,
    collected,
    stale: rows.data.length - collected,
    firstAt,
    lastAt: latestAt,
    failures,
    coverage,
  };
}
