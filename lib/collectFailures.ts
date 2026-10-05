// 수집 실패 기록 (collect_failures 테이블).
// 수집에 실패하면 순위를 덮어쓰지 않으므로, 기록이 없으면 "실패"와 "아직 수집 전"을 구분할 수 없다.
// 여기 남긴 기록으로 수집 상태 화면과 알림이 실패 건수·종류를 보여준다.
//
// 기록 자체가 실패해도 배치를 멈추면 안 되므로 어떤 경우에도 예외를 던지지 않는다.

import { supabase } from "@/lib/supabase";
import { getKSTDateString } from "@/lib/dateUtils";

export type CollectMode = "blog" | "cafe" | "reporter";

export type FailureKind =
  | "serp" // 네이버 검색 화면을 받지 못했거나 읽지 못함 (오류·시간 초과·차단·구조 변경)
  | "resolve" // 등록 URL(단축 URL·숫자 ID)을 해석하지 못함
  | "db" // 순위 저장 실패
  | "history" // 이력 저장 실패
  | "other";

export const FAILURE_LABEL: Record<FailureKind, string> = {
  serp: "네이버 수집 실패",
  resolve: "등록 URL 해석 실패",
  db: "순위 저장 실패",
  history: "이력 저장 실패",
  other: "기타 오류",
};

export async function recordFailure(
  mode: CollectMode,
  keywordId: string,
  kind: FailureKind,
  detail: string
): Promise<void> {
  try {
    const { error } = await supabase.from("collect_failures").insert({
      kst_date: getKSTDateString(),
      mode,
      keyword_id: keywordId,
      kind,
      detail: detail.slice(0, 300),
    });
    if (error) console.warn(`[collect_failures] 기록 실패: ${error.message}`);
  } catch (err) {
    console.warn("[collect_failures] 기록 실패:", err);
  }
}
