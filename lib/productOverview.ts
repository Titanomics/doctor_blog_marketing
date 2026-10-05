// 제품 쪽(카페 키워드 · 블로그기자단) 순위 변동 요약. 슬랙 알림이 쓴다.
// 변동은 직전 수집(previous_rank)과 최근 수집(current_rank)의 비교이며,
// 최근 수집일에 갱신되지 않은 행의 변동은 "오늘의 사건"으로 세지 않는다.

import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";

const DELETED_TITLE = "[삭제된 게시글]";

export interface RankMove {
  keyword: string;
  brand: string;
  previous: number | null;
  current: number | null;
}

export interface ProductSide {
  total: number;
  exposed: number; // 검색에 노출 중
  appeared: RankMove[]; // 미노출 → 노출
  disappeared: RankMove[]; // 노출 → 미노출
  moved: RankMove[]; // 노출 유지, 순위 3계단 이상 변동
}

const kstDate = (iso: string | null) => (iso ? getKSTDateString(new Date(iso)) : null);

function summarize(
  rows: { keyword: string; brand: string; current: number | null; previous: number | null; updatedAt: string | null; skip?: boolean }[]
): ProductSide {
  let latest: string | null = null;
  for (const r of rows) if (r.updatedAt && (!latest || r.updatedAt > latest)) latest = r.updatedAt;
  const latestDate = kstDate(latest);

  const side: ProductSide = { total: rows.length, exposed: 0, appeared: [], disappeared: [], moved: [] };
  for (const r of rows) {
    if (r.current !== null) side.exposed++;
    if (r.skip || kstDate(r.updatedAt) !== latestDate) continue;
    const move = { keyword: r.keyword, brand: r.brand, previous: r.previous, current: r.current };
    if (r.previous === null && r.current !== null) side.appeared.push(move);
    else if (r.previous !== null && r.current === null) side.disappeared.push(move);
    else if (r.previous !== null && r.current !== null && Math.abs(r.current - r.previous) >= 3) side.moved.push(move);
  }
  side.appeared.sort((a, b) => a.current! - b.current!);
  side.disappeared.sort((a, b) => a.previous! - b.previous!);
  side.moved.sort((a, b) => b.previous! - b.current! - (a.previous! - a.current!)); // 많이 오른 순
  return side;
}

export async function loadProductOverview(): Promise<{ cafe: ProductSide; reporter: ProductSide; error: string | null }> {
  const { data: brands } = await supabase.from("cafe_clients").select("id, name");
  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name as string]));

  const cafe = await fetchAll<{
    client_id: string;
    keyword: string;
    current_rank: number | null;
    previous_rank: number | null;
    updated_at: string | null;
    matched_title: string | null;
  }>((from, to) =>
    supabase
      .from("cafe_keywords")
      .select("client_id, keyword, current_rank, previous_rank, updated_at, matched_title")
      .order("id", { ascending: true })
      .range(from, to)
  );

  const reporterKeywords = await fetchAll<{ id: string; keyword: string; client_id: string }>((from, to) =>
    supabase.from("reporter_keywords").select("id, keyword, client_id").order("id", { ascending: true }).range(from, to)
  );
  const keywordById = new Map(reporterKeywords.data.map((k) => [k.id, k]));
  const entries = await fetchAll<{
    keyword_id: string;
    current_rank: number | null;
    previous_rank: number | null;
    updated_at: string | null;
  }>((from, to) =>
    supabase
      .from("reporter_blog_entries")
      .select("keyword_id, current_rank, previous_rank, updated_at")
      .order("id", { ascending: true })
      .range(from, to)
  );

  return {
    cafe: summarize(
      cafe.data.map((k) => ({
        keyword: k.keyword,
        brand: brandName.get(k.client_id) ?? "",
        current: k.current_rank,
        previous: k.previous_rank,
        updatedAt: k.updated_at,
        // 삭제된 글의 "노출 → 미노출"은 삭제 알림에서 따로 다룬다
        skip: k.matched_title === DELETED_TITLE,
      }))
    ),
    reporter: summarize(
      entries.data.map((e) => {
        const kw = keywordById.get(e.keyword_id);
        return {
          keyword: kw?.keyword ?? "(삭제된 키워드)",
          brand: kw ? brandName.get(kw.client_id) ?? "" : "",
          current: e.current_rank,
          previous: e.previous_rank,
          updatedAt: e.updated_at,
        };
      })
    ),
    error: cafe.error ?? reporterKeywords.error ?? entries.error,
  };
}
