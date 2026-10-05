import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";
import { TOP_RANK } from "@/lib/trend";

type KeywordRow = {
  id: string;
  client_id: string;
  keyword: string;
  current_rank: number | null;
  previous_rank: number | null;
  updated_at: string | null;
};

const isTop = (r: number | null) => r !== null && r <= TOP_RANK;
const kstDate = (iso: string | null) => (iso ? getKSTDateString(new Date(iso)) : null);

// 블로그 전체 병원 요약 + 조치 목록 (/api/overview 와 슬랙 알림이 함께 쓴다)
// 이탈·진입은 직전 수집(previous_rank)과 최근 수집(current_rank)의 비교다.
export async function loadBlogOverview() {
  const [{ data: clients, error: clientError }, keywordResult] = await Promise.all([
    supabase.from("clients").select("id, name, assignee, blog_url, created_at").order("name"),
    fetchAll<KeywordRow>((from, to) =>
      supabase
        .from("keywords")
        .select("id, client_id, keyword, current_rank, previous_rank, updated_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);
  if (clientError) return { error: clientError.message };
  if (keywordResult.error) return { error: keywordResult.error };

  const keywords = keywordResult.data;

  // 가장 최근 수집일(KST). 그날 갱신되지 않은 키워드는 "최근 수집에서 빠짐"으로 센다.
  let latestDate: string | null = null;
  let latestAt: string | null = null;
  for (const k of keywords) {
    if (k.updated_at && (!latestAt || k.updated_at > latestAt)) latestAt = k.updated_at;
  }
  latestDate = kstDate(latestAt);

  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const summary = new Map(
    (clients ?? []).map((c) => [
      c.id,
      { client: c, total: 0, top: 0, exposed: 0, dropped: 0, entered: 0, stale: 0 },
    ])
  );
  const dropped: { clientId: string; clientName: string; keyword: string; previous: number; current: number | null }[] = [];
  const entered: { clientId: string; clientName: string; keyword: string; previous: number | null; current: number }[] = [];

  for (const k of keywords) {
    const s = summary.get(k.client_id);
    if (!s) continue;
    s.total++;
    if (k.current_rank !== null) s.exposed++;
    if (isTop(k.current_rank)) s.top++;

    const fresh = kstDate(k.updated_at) === latestDate;
    if (!fresh) {
      s.stale++;
      continue; // 최근 수집에서 빠진 키워드의 변동은 "오늘의 사건"으로 세지 않는다
    }
    const name = clientName.get(k.client_id) ?? "";
    if (isTop(k.previous_rank) && !isTop(k.current_rank)) {
      s.dropped++;
      dropped.push({ clientId: k.client_id, clientName: name, keyword: k.keyword, previous: k.previous_rank!, current: k.current_rank });
    } else if (!isTop(k.previous_rank) && isTop(k.current_rank)) {
      s.entered++;
      entered.push({ clientId: k.client_id, clientName: name, keyword: k.keyword, previous: k.previous_rank, current: k.current_rank! });
    }
  }

  dropped.sort((a, b) => a.previous - b.previous);
  entered.sort((a, b) => a.current - b.current);

  return {
    error: null,
    data: {
      latestAt,
      latestDate,
      totals: {
        keywords: keywords.length,
        top: keywords.filter((k) => isTop(k.current_rank)).length,
        exposed: keywords.filter((k) => k.current_rank !== null).length,
        stale: [...summary.values()].reduce((n, s) => n + s.stale, 0),
      },
      dropped,
      entered,
      clients: [...summary.values()],
    },
  };
}
