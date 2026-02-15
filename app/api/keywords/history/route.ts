import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/keywords/history?keywordId=UUID - 최근 30일 히스토리
export async function GET(request: NextRequest) {
  const keywordId = request.nextUrl.searchParams.get("keywordId");

  if (!keywordId) {
    return NextResponse.json(
      { error: "keywordId가 필요합니다." },
      { status: 400 }
    );
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from("keyword_history")
    .select("*")
    .eq("keyword_id", keywordId)
    .gte("tracked_date", thirtyDaysAgo.toISOString().split("T")[0])
    .order("tracked_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
