import { NextRequest, NextResponse } from "next/server";
import { isJobAuthorization } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { getKSTDateString } from "@/lib/dateUtils";
import { fetchKeywordVolumes, hasNaverAdKeys, normalizeKeyword } from "@/lib/naverAd";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// 키워드 검색량 수집 (네이버 검색광고 공식 API).
// 호출: POST /api/keyword-volumes/collect   (인증: CRON_SECRET Bearer)
//
// 값이 "최근 30일 합계"라 매일 볼 필요가 없다. 키워드마다 최근 REFRESH_DAYS일 안에 기록이 있으면 건너뛴다.
// 새로 등록된 키워드는 다음 실행에서 바로 채워진다. remaining 이 0이 될 때까지 반복 호출.

const REFRESH_DAYS = 6; // 주 1회 갱신
const TIME_BUDGET_MS = 230_000;
const MAX_PER_CALL = 600;

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || !isJobAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasNaverAdKeys()) {
    return NextResponse.json(
      { error: "NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID 환경변수가 없습니다." },
      { status: 500 }
    );
  }

  const startedAt = Date.now();
  const today = getKSTDateString();
  const since = getKSTDateString(new Date(Date.now() - REFRESH_DAYS * 86_400_000));

  // 블로그·카페·기자단에 등록된 모든 키워드 (공백 제거·대문자 기준으로 중복 제거)
  const wanted = new Set<string>();
  for (const table of ["keywords", "cafe_keywords", "reporter_keywords"] as const) {
    const { data, error } = await fetchAll<{ keyword: string }>((from, to) =>
      supabase.from(table).select("keyword").order("id", { ascending: true }).range(from, to)
    );
    if (error) return NextResponse.json({ error: `${table} 조회 실패: ${error}` }, { status: 500 });
    for (const row of data) {
      const key = normalizeKeyword(row.keyword ?? "");
      if (key) wanted.add(key);
    }
  }

  const recent = await fetchAll<{ keyword: string }>((from, to) =>
    supabase
      .from("keyword_volumes")
      .select("keyword")
      .gt("tracked_date", since)
      .order("keyword", { ascending: true })
      .range(from, to)
  );
  if (recent.error) {
    return NextResponse.json({ error: `keyword_volumes 조회 실패: ${recent.error}` }, { status: 500 });
  }
  const fresh = new Set(recent.data.map((r) => r.keyword));
  const pending = [...wanted].filter((k) => !fresh.has(k));

  const { volumes, attempted, failedCalls } = await fetchKeywordVolumes(
    pending.slice(0, MAX_PER_CALL),
    startedAt + TIME_BUDGET_MS
  );

  // API가 값을 주지 않은 키워드도 "조회했으나 데이터 없음"으로 기록한다 (pc·mobile = null).
  // 그래야 매 실행마다 같은 키워드를 다시 묻지 않는다. 호출 자체가 실패한 경우는 구분할 수 없어
  // 실패가 한 번이라도 있으면 값이 없는 키워드는 기록하지 않고 다음 실행에 맡긴다.
  const rows = pending.slice(0, attempted).flatMap((keyword) => {
    const v = volumes.get(keyword);
    if (!v && failedCalls > 0) return [];
    return [
      {
        keyword,
        tracked_date: today,
        pc: v?.pc ?? null,
        mobile: v?.mobile ?? null,
        observed_at: new Date().toISOString(),
      },
    ];
  });

  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("keyword_volumes").upsert(chunk, { onConflict: "keyword,tracked_date" });
    if (error) {
      return NextResponse.json({ error: `keyword_volumes 저장 실패: ${error.message}` }, { status: 500 });
    }
    saved += chunk.length;
  }

  return NextResponse.json({
    date: today,
    keywords: wanted.size,
    upToDate: wanted.size - pending.length,
    attempted,
    withVolume: volumes.size,
    saved,
    failedCalls,
    remaining: pending.length - saved,
    elapsedMs: Date.now() - startedAt,
  });
}
