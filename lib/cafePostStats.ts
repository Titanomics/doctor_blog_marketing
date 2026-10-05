// 카페 글 일별 관측(cafe_post_stats) 공통 로직.
// 글 단위(카페 이름 + 글 번호)로 하루 한 행. 조회수·댓글 수·생존 여부를 담는다.
// 수집은 /api/cafe/post-stats 가 하고, 키워드 배치는 그 결과를 읽어 쓴다.

import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

// "위닝" 판정 기준: 연속된 두 일별 관측 사이 조회수 증가가 이 값 이상
export const WINNING_READ_DELTA = 100;
// 두 관측을 "하루 간격"으로 인정하는 실제 시간 범위
export const WINNING_MIN_GAP_HOURS = 12;
export const WINNING_MAX_GAP_HOURS = 36;

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
