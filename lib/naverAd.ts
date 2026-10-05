// 네이버 검색광고 API(공식) 키워드도구로 키워드별 "최근 30일 검색량"을 조회한다.
//
// 환경변수 3개가 모두 있어야 동작:
//   NAVER_AD_API_KEY     = 액세스 라이선스
//   NAVER_AD_SECRET_KEY  = 비밀키
//   NAVER_AD_CUSTOMER_ID = 고객 ID
//
// 반환값은 일별 수치가 아니라 조회 시점 기준 최근 30일 합계다.

import { createHmac } from "crypto";

const BASE = "https://api.searchad.naver.com";
const PATH = "/keywordstool";
const HINTS_PER_CALL = 5; // API 제한
const CALL_INTERVAL_MS = 300;

export interface KeywordVolume {
  pc: number; // 0 = "10 미만"
  mobile: number;
}

// 검색광고 API는 공백 없는 키워드만 받는다. 대조도 이 형태로 한다.
export function normalizeKeyword(keyword: string): string {
  return keyword.replace(/\s/g, "").toUpperCase();
}

// API는 10 미만을 "< 10" 문자열로 준다 → 0으로 저장하고 화면에서 "10 미만"으로 표시
function toCount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

export function hasNaverAdKeys(): boolean {
  return !!(process.env.NAVER_AD_API_KEY && process.env.NAVER_AD_SECRET_KEY && process.env.NAVER_AD_CUSTOMER_ID);
}

async function callKeywordTool(hints: string[]): Promise<Map<string, KeywordVolume> | "error"> {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", process.env.NAVER_AD_SECRET_KEY!)
    .update(`${timestamp}.GET.${PATH}`)
    .digest("base64");
  try {
    const res = await fetch(
      `${BASE}${PATH}?hintKeywords=${encodeURIComponent(hints.join(","))}&showDetail=1`,
      {
        headers: {
          "X-Timestamp": timestamp,
          "X-API-KEY": process.env.NAVER_AD_API_KEY!,
          "X-Customer": process.env.NAVER_AD_CUSTOMER_ID!,
          "X-Signature": signature,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return "error";
    }
    const data = (await res.json()) as {
      keywordList?: { relKeyword: string; monthlyPcQcCnt: unknown; monthlyMobileQcCnt: unknown }[];
    };
    // 응답에는 연관 키워드가 수백 개 섞여 온다. 요청한 키워드와 정확히 같은 것만 쓴다.
    const wanted = new Set(hints);
    const out = new Map<string, KeywordVolume>();
    for (const item of data.keywordList ?? []) {
      const key = normalizeKeyword(item.relKeyword);
      if (wanted.has(key) && !out.has(key)) {
        out.set(key, { pc: toCount(item.monthlyPcQcCnt), mobile: toCount(item.monthlyMobileQcCnt) });
      }
    }
    return out;
  } catch {
    return "error";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// normalized: normalizeKeyword()를 거친 키워드 목록.
// 결과에 없는 키워드는 API가 값을 주지 않았거나(검색량 없음·허용되지 않는 문자) 호출이 실패한 것.
export async function fetchKeywordVolumes(
  normalized: string[],
  deadline: number
): Promise<{ volumes: Map<string, KeywordVolume>; attempted: number; failedCalls: number }> {
  const volumes = new Map<string, KeywordVolume>();
  let attempted = 0;
  let failedCalls = 0;

  for (let i = 0; i < normalized.length; i += HINTS_PER_CALL) {
    if (Date.now() > deadline) break;
    if (i > 0) await sleep(CALL_INTERVAL_MS);
    const batch = normalized.slice(i, i + HINTS_PER_CALL);
    attempted += batch.length;

    let result = await callKeywordTool(batch);
    if (result === "error" && batch.length > 1) {
      // 한 키워드의 허용되지 않는 문자 때문에 묶음 전체가 거절될 수 있다 → 하나씩 다시 시도
      result = new Map();
      for (const one of batch) {
        await sleep(CALL_INTERVAL_MS);
        const single = await callKeywordTool([one]);
        if (single === "error") failedCalls++;
        else for (const [k, v] of single) result.set(k, v);
      }
    } else if (result === "error") {
      failedCalls++;
      continue;
    }
    for (const [k, v] of result) volumes.set(k, v);
  }

  return { volumes, attempted, failedCalls };
}
