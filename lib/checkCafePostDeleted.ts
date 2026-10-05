// 카페 게시글 상태 판정
// - 'deleted': 명시적 삭제 확인 (404 + errorCode 4003)
// - 'alive':   정상 게시글 (200 OK)
// - 'unknown': 일시적 API 장애/네트워크 오류/예상 외 응답 (5xx, 비4003 4xx, fetch 실패 등)
//
// 'unknown' 케이스는 호출부에서 기존 상태 보존(자동 갱신 보류)에 사용한다.
import { fetchCafePost } from "@/lib/cafePost";

export type CafePostStatus = "deleted" | "alive" | "unknown";

export async function getCafePostStatus(postUrl: string): Promise<CafePostStatus> {
  // URL 파싱: cafe.naver.com/{shortcut}/{articleId}
  const m = postUrl.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
  if (!m) return "unknown";
  return (await fetchCafePost(m[1], m[2])).status;
}

// 하위 호환: boolean 시그니처 유지 (legacy 호출부용)
// 'deleted'만 true로 매핑. 'unknown'은 false (즉, 보수적으로 미변경 신호 아님)
export async function checkCafePostDeleted(postUrl: string): Promise<boolean> {
  return (await getCafePostStatus(postUrl)) === "deleted";
}
