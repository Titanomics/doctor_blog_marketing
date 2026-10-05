// 제품 쪽(카페 키워드 · 블로그기자단) 순위 현황과 변동. 슬랙 알림이 쓴다.
// 변동은 직전 수집(previous_rank)과 최근 수집(current_rank)의 비교이며,
// 최근 수집일에 갱신되지 않은 행의 변동은 "오늘의 사건"으로 세지 않는다.

import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";
import { postKey } from "@/lib/cafePostStats";

const DELETED_TITLE = "[삭제된 게시글]";

export interface RankRow {
  keyword: string;
  brand: string;
  current: number | null;
  previous: number | null;
  fresh: boolean; // 최근 수집일에 갱신됨
  deleted: boolean; // 글이 삭제됨 (카페)
  reply: boolean; // 꼬리글로만 노출 (카페)
}

export interface ProductSide {
  rows: RankRow[];
  exposed: RankRow[]; // 순위가 있는 것, 순위 오름차순
  unexposed: RankRow[]; // 순위 없음 (삭제·꼬리글 제외)
  replies: RankRow[];
  deletedCount: number;
  appeared: RankRow[]; // 미노출 → 노출
  disappeared: RankRow[]; // 노출 → 미노출 (삭제된 글 제외)
  rose: RankRow[]; // 3계단 이상 상승
  fell: RankRow[]; // 3계단 이상 하락
}

const kstDate = (iso: string | null) => (iso ? getKSTDateString(new Date(iso)) : null);

function summarize(raw: (Omit<RankRow, "fresh"> & { updatedAt: string | null })[]): ProductSide {
  let latest: string | null = null;
  for (const r of raw) if (r.updatedAt && (!latest || r.updatedAt > latest)) latest = r.updatedAt;
  const latestDate = kstDate(latest);
  const rows: RankRow[] = raw.map(({ updatedAt, ...r }) => ({ ...r, fresh: kstDate(updatedAt) === latestDate }));

  const live = rows.filter((r) => !r.deleted);
  const moved = (r: RankRow) => r.fresh && r.previous !== null && r.current !== null;
  return {
    rows,
    exposed: live.filter((r) => r.current !== null && !r.reply).sort((a, b) => a.current! - b.current!),
    unexposed: live.filter((r) => r.current === null && !r.reply),
    replies: live.filter((r) => r.reply),
    deletedCount: rows.length - live.length,
    appeared: live.filter((r) => r.fresh && r.previous === null && r.current !== null).sort((a, b) => a.current! - b.current!),
    disappeared: live.filter((r) => r.fresh && r.previous !== null && r.current === null).sort((a, b) => a.previous! - b.previous!),
    rose: live.filter((r) => moved(r) && r.previous! - r.current! >= 3).sort((a, b) => b.previous! - b.current! - (a.previous! - a.current!)),
    fell: live.filter((r) => moved(r) && r.current! - r.previous! >= 3).sort((a, b) => b.current! - b.previous! - (a.current! - a.previous!)),
  };
}

// brandPrefixes: 이 문자열로 시작하는 이름의 브랜드만 포함한다 (빈 배열이면 전체)
export async function loadProductOverview(brandPrefixes: string[]): Promise<{
  brands: string[];
  cafe: ProductSide;
  reporter: ProductSide;
  postKeys: Set<string>; // 포함된 브랜드의 카페 글 (카페이름/글번호)
  error: string | null;
}> {
  const { data: allBrands, error: brandError } = await supabase.from("cafe_clients").select("id, name");
  const brands = (allBrands ?? [])
    .filter((b) => brandPrefixes.length === 0 || brandPrefixes.some((p) => (b.name as string).startsWith(p)))
    .sort((a, b) => (a.name as string).localeCompare(b.name as string, "ko")); // 대표 브랜드(짧은 이름)가 앞에 오게
  const brandName = new Map(brands.map((b) => [b.id, b.name as string]));

  const cafe = await fetchAll<{
    client_id: string;
    keyword: string;
    current_rank: number | null;
    previous_rank: number | null;
    updated_at: string | null;
    matched_title: string | null;
    is_reply: boolean | null;
    post_cafe: string | null;
    post_article_id: string | null;
  }>((from, to) =>
    supabase
      .from("cafe_keywords")
      .select("client_id, keyword, current_rank, previous_rank, updated_at, matched_title, is_reply, post_cafe, post_article_id")
      .order("id", { ascending: true })
      .range(from, to)
  );
  const cafeRows = cafe.data.filter((k) => brandName.has(k.client_id));
  const postKeys = new Set<string>();
  for (const k of cafeRows) if (k.post_cafe && k.post_article_id) postKeys.add(postKey(k.post_cafe, k.post_article_id));

  const reporterKeywords = await fetchAll<{ id: string; keyword: string; client_id: string }>((from, to) =>
    supabase.from("reporter_keywords").select("id, keyword, client_id").order("id", { ascending: true }).range(from, to)
  );
  const keywordById = new Map(reporterKeywords.data.filter((k) => brandName.has(k.client_id)).map((k) => [k.id, k]));
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
    brands: brands.map((b) => b.name as string),
    cafe: summarize(
      cafeRows.map((k) => ({
        keyword: k.keyword,
        brand: brandName.get(k.client_id) ?? "",
        current: k.current_rank,
        previous: k.previous_rank,
        updatedAt: k.updated_at,
        deleted: k.matched_title === DELETED_TITLE,
        reply: !!k.is_reply,
      }))
    ),
    reporter: summarize(
      entries.data
        .filter((e) => keywordById.has(e.keyword_id))
        .map((e) => {
          const kw = keywordById.get(e.keyword_id)!;
          return {
            keyword: kw.keyword,
            brand: brandName.get(kw.client_id) ?? "",
            current: e.current_rank,
            previous: e.previous_rank,
            updatedAt: e.updated_at,
            deleted: false,
            reply: false,
          };
        })
    ),
    postKeys,
    error: brandError?.message ?? cafe.error ?? reporterKeywords.error ?? entries.error,
  };
}
