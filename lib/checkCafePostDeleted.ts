// 카페 게시글 상태 판정
// - 'deleted': 명시적 삭제 확인 (404 + errorCode 4003, 또는 404 + JSON 파싱 실패)
// - 'alive':   정상 게시글 (200 OK)
// - 'unknown': 일시적 API 장애/네트워크 오류/예상 외 응답 (5xx, 비4003 4xx, fetch 실패 등)
//
// 'unknown' 케이스는 호출부에서 기존 상태 보존(자동 갱신 보류)에 사용한다.
export type CafePostStatus = "deleted" | "alive" | "unknown";

export async function getCafePostStatus(postUrl: string): Promise<CafePostStatus> {
  try {
    // URL 파싱: cafe.naver.com/{shortcut}/{articleId}
    const m = postUrl.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
    if (!m) return "unknown";
    const [, shortcut, articleId] = m;

    const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${shortcut}/articles/${articleId}?query=&menuId=0&useCafeId=false&requestFrom=A`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
      },
      cache: "no-store",
    });

    if (res.status === 200) return "alive";

    if (res.status === 404) {
      try {
        const data = await res.json();
        if (data?.result?.errorCode === "4003") return "deleted";
        // 404인데 4003이 아닌 다른 errorCode → 보수적으로 unknown
        return "unknown";
      } catch {
        // 404 + JSON 파싱 실패 → WAF/Cloudflare 빈 응답 등 모호한 케이스 → unknown
        // (이전엔 'deleted' 단정했으나 false-positive 누적 위험으로 변경)
        return "unknown";
      }
    }

    // 5xx 등 그 외 응답 → unknown
    return "unknown";
  } catch {
    // 네트워크 오류/타임아웃 등 → unknown
    return "unknown";
  }
}

// 하위 호환: boolean 시그니처 유지 (legacy 호출부용)
// 'deleted'만 true로 매핑. 'unknown'은 false (즉, 보수적으로 미변경 신호 아님)
export async function checkCafePostDeleted(postUrl: string): Promise<boolean> {
  return (await getCafePostStatus(postUrl)) === "deleted";
}
