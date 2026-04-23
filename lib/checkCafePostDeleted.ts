// 카페 게시글이 삭제됐는지 확인
// 네이버 카페 공개 API 사용: errorCode 4003 = 삭제됨/존재하지 않음
export async function checkCafePostDeleted(postUrl: string): Promise<boolean> {
  try {
    // URL 파싱: cafe.naver.com/{shortcut}/{articleId}
    const m = postUrl.match(/cafe\.naver\.com\/([^/?#]+)\/(\d+)/);
    if (!m) return false;
    const [, shortcut, articleId] = m;

    const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${shortcut}/articles/${articleId}?query=&menuId=0&useCafeId=false&requestFrom=A`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
      },
      cache: "no-store",
    });

    // 404 + errorCode 4003 = 삭제됨
    if (res.status === 404) {
      try {
        const data = await res.json();
        return data?.result?.errorCode === "4003";
      } catch {
        return true; // 404면 일단 삭제로 간주
      }
    }
    // 200 = 정상 글
    return false;
  } catch {
    return false;
  }
}
