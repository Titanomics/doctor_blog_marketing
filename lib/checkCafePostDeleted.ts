// 카페 게시글이 삭제됐는지 확인 (URL 직접 조회)
// 모바일 URL이 더 명확한 응답을 주므로 모바일로 전환
export async function checkCafePostDeleted(postUrl: string): Promise<boolean> {
  try {
    const mobileUrl = postUrl.replace(/^https?:\/\/cafe\.naver\.com/, "https://m.cafe.naver.com");
    const res = await fetch(mobileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (res.status === 404) return true;
    if (!res.ok) return false;
    const html = await res.text();
    const deletedMarkers = [
      "삭제된 게시글",
      "삭제된 글",
      "존재하지 않는 게시글",
      "존재하지 않습니다",
      "게시글을 찾을 수 없",
      "열람할 수 없",
    ];
    return deletedMarkers.some((marker) => html.includes(marker));
  } catch {
    return false;
  }
}
