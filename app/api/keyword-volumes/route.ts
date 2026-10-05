import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { normalizeKeyword } from "@/lib/naverAd";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLES = { blog: "keywords", cafe: "cafe_keywords", reporter: "reporter_keywords" } as const;

export interface VolumeInfo {
  pc: number | null; // null = 검색광고 API가 값을 주지 않음, 0 = 10 미만
  mobile: number | null;
  date: string; // 조회한 날 (값은 그날 기준 최근 30일 합계)
  previous: { pc: number | null; mobile: number | null; date: string } | null; // 그 전 조회
}

// GET /api/keyword-volumes?mode=blog|cafe|reporter&clientId=UUID
// 고객의 키워드별 최근 30일 검색량. 최신 조회와 그 직전 조회를 함께 준다.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const mode = (sp.get("mode") ?? "blog") as keyof typeof TABLES;
  if (!clientId || !TABLES[mode]) {
    return NextResponse.json({ error: "mode와 clientId가 필요합니다." }, { status: 400 });
  }

  const { data: keywords, error } = await supabase
    .from(TABLES[mode])
    .select("id, keyword")
    .eq("client_id", clientId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byNormalized = new Map<string, string[]>();
  for (const k of keywords ?? []) {
    const key = normalizeKeyword(k.keyword ?? "");
    if (!key) continue;
    const ids = byNormalized.get(key);
    if (ids) ids.push(k.id);
    else byNormalized.set(key, [k.id]);
  }

  const volumes: Record<string, VolumeInfo> = {};
  const names = [...byNormalized.keys()];
  // 키워드 목록이 길면 URL이 길어지므로 나눠서 조회
  for (let i = 0; i < names.length; i += 100) {
    const { data: rows, error: volumeError } = await supabase
      .from("keyword_volumes")
      .select("keyword, tracked_date, pc, mobile")
      .in("keyword", names.slice(i, i + 100))
      .order("tracked_date", { ascending: false })
      .limit(1000);
    if (volumeError) return NextResponse.json({ error: volumeError.message }, { status: 500 });

    const seen = new Map<string, number>();
    for (const row of rows ?? []) {
      const n = seen.get(row.keyword) ?? 0;
      seen.set(row.keyword, n + 1);
      for (const id of byNormalized.get(row.keyword) ?? []) {
        if (n === 0) volumes[id] = { pc: row.pc, mobile: row.mobile, date: row.tracked_date, previous: null };
        else if (n === 1) volumes[id].previous = { pc: row.pc, mobile: row.mobile, date: row.tracked_date };
      }
    }
  }

  return NextResponse.json({ volumes }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
