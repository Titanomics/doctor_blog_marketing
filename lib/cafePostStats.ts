// 카페 글 일별 관측(cafe_post_stats) 공통 로직.
// 글 단위(카페 이름 + 글 번호)로 하루 한 행. 조회수·댓글 수·생존 여부를 담는다.
// 수집은 /api/cafe/post-stats 가 하고, 키워드 배치는 그 결과를 읽어 쓴다.

import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

// "위닝" 판정 기준: 글의 누적 조회수가 이 값 이상 (발행 직후 글도 포함)
export const WINNING_READ_COUNT = 100;

export function isWinning(readCount: number | null | undefined): boolean {
  return typeof readCount === "number" && readCount >= WINNING_READ_COUNT;
}

export function postKey(cafe: string, articleId: string): string {
  return `${cafe}/${articleId}`;
}

// 삭제 확인된 글의 재확인 요일: 키에서 0~6을 뽑아 KST 날짜와 맞는 날만 true
// (글들이 7일에 고르게 분산되어 하루 조회량이 일정해진다)
export function isWeeklyRecheckDay(key: string, nowMs: number = Date.now()): boolean {
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  const kstDay = Math.floor((nowMs + 9 * 60 * 60 * 1000) / 86_400_000);
  return (sum + kstDay) % 7 === 0;
}

// 오늘(KST) 이미 관측된 글의 상태. 관측이 없거나 조회 오류면 null.
export async function getTodayPostStatus(
  cafe: string,
  articleId: string
): Promise<"alive" | "deleted" | null> {
  const { data, error } = await supabase
    .from("cafe_post_stats")
    .select("status")
    .eq("cafe", cafe)
    .eq("article_id", articleId)
    .eq("tracked_date", getKSTDateString())
    .maybeSingle();
  if (error || !data) return null;
  return data.status === "alive" || data.status === "deleted" ? data.status : null;
}

export interface PostStat {
  cafe: string;
  article_id: string;
  tracked_date: string;
  status: "alive" | "deleted";
  read_count: number | null;
  comment_count: number | null;
  member_count: number | null;
  observed_at: string;
}

// 가장 최근 수집일의 관측과, 그 전날(KST)의 관측을 글 키로 묶어 돌려준다.
// 전날 관측이 없으면 previous 는 빈 Map — 증가량은 계산하지 않는다.
export async function loadLatestPostStats(): Promise<{
  latestDate: string | null;
  latest: Map<string, PostStat>;
  previous: Map<string, PostStat>;
  error: string | null;
}> {
  const empty = { latestDate: null, latest: new Map<string, PostStat>(), previous: new Map<string, PostStat>() };

  const { data: head, error: headError } = await supabase
    .from("cafe_post_stats")
    .select("tracked_date")
    .order("tracked_date", { ascending: false })
    .limit(1);
  if (headError) return { ...empty, error: headError.message };
  const latestDate: string | undefined = head?.[0]?.tracked_date;
  if (!latestDate) return { ...empty, error: null };

  const previousDate = new Date(new Date(`${latestDate}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const load = async (date: string) => {
    const map = new Map<string, PostStat>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("cafe_post_stats")
        .select("cafe, article_id, tracked_date, status, read_count, comment_count, member_count, observed_at")
        .eq("tracked_date", date)
        .range(from, from + 999);
      if (error) return { map, error: error.message };
      for (const r of (data ?? []) as PostStat[]) map.set(postKey(r.cafe, r.article_id), r);
      if (!data || data.length < 1000) break;
    }
    return { map, error: null as string | null };
  };

  const [a, b] = await Promise.all([load(latestDate), load(previousDate)]);
  return { latestDate, latest: a.map, previous: b.map, error: a.error ?? b.error };
}

export interface KeywordPostStat {
  readCount: number | null; // null = 조회수를 볼 수 없음(로그인 필요) 또는 삭제
  commentCount: number | null;
  delta: number | null; // 전날 대비 조회수 증가. 전날 관측이 없으면 null
  restricted: boolean; // 글은 있으나 로그인해야 볼 수 있음
  deleted: boolean;
  winning: boolean;
  memberCount: number | null;
}

// 한 글의 최신 관측을 화면용 값으로 정리
export function summarizePostStat(latest: PostStat, previous: PostStat | undefined): KeywordPostStat {
  const alive = latest.status === "alive";
  const readCount = alive ? latest.read_count : null;
  const prevRead = previous?.status === "alive" ? previous.read_count : null;
  const delta =
    readCount !== null && prevRead !== null && readCount >= prevRead ? readCount - prevRead : null;
  return {
    readCount,
    commentCount: alive ? latest.comment_count : null,
    delta,
    restricted: alive && latest.read_count === null,
    deleted: latest.status === "deleted",
    winning: isWinning(readCount),
    memberCount: alive ? latest.member_count : null,
  };
}
