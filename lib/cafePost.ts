// 네이버 카페 글 1건 조회 (비공식 카페 웹 API).
// 응답 하나로 생존 여부·조회수·댓글 수를 함께 얻는다 — 글당 하루 1회만 부르는 것이 원칙.
//
// - alive:   글이 존재함. 공개 글(200)이면 조회수 등 포함.
//            로그인해야 볼 수 있는 글(401 + 0004)은 존재는 확인되지만 조회수를 얻을 수 없어
//            readCount 등이 null 이다. (삭제된 글은 로그인 여부와 무관하게 404 + 4003 으로 응답함을
//            2026-10 실측으로 확인 — 따라서 401 은 "존재하는 글"로 본다)
// - deleted: 명시적 삭제 확인 (404 + errorCode 4003)
// - unknown: 일시 장애·차단·예상 외 응답. 호출부는 기존 상태를 보존해야 한다

export type CafePostObservation =
  | {
      status: "alive";
      readCount: number | null;
      commentCount: number | null;
      clubId: string | null;
      memberCount: number | null;
      writeDate: string | null; // ISO
    }
  | { status: "deleted" }
  | { status: "unknown" };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0";

function toInt(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
}

// cafe: 카페 이름(cafe.naver.com/{cafe}/...), articleId: 글 번호
export async function fetchCafePost(cafe: string, articleId: string): Promise<CafePostObservation> {
  try {
    // v3 엔드포인트는 2026-10 현재 모든 요청에 500을 반환한다. v2.1은 정상 동작.
    const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${encodeURIComponent(cafe)}/articles/${encodeURIComponent(articleId)}?query=&useCafeId=false&requestFrom=A`;
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 200) {
      const result = (await res.json())?.result;
      const article = result?.article;
      if (!article) return { status: "unknown" };
      const writeMs = toInt(article.writeDate);
      return {
        status: "alive",
        readCount: toInt(article.readCount),
        commentCount: toInt(article.commentCount),
        clubId: result?.cafe?.id != null ? String(result.cafe.id) : null,
        memberCount: toInt(result?.cafe?.memberCount),
        writeDate: writeMs ? new Date(writeMs).toISOString() : null,
      };
    }

    if (res.status === 401) {
      try {
        const data = await res.json();
        if (data?.result?.errorCode === "0004") {
          return {
            status: "alive",
            readCount: null,
            commentCount: null,
            clubId: null,
            memberCount: null,
            writeDate: null,
          };
        }
      } catch {
        // 아래에서 unknown 처리
      }
      return { status: "unknown" };
    }

    if (res.status === 404) {
      try {
        const data = await res.json();
        if (data?.result?.errorCode === "4003") return { status: "deleted" };
      } catch {
        // 404 + JSON 파싱 실패 → WAF 빈 응답 등 모호한 케이스
      }
      return { status: "unknown" };
    }

    await res.body?.cancel().catch(() => {});
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}
