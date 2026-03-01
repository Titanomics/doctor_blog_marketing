import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveReporterHistory } from "@/lib/saveReporterHistory";

export async function GET(request: NextRequest) {
  const keywordId = request.nextUrl.searchParams.get("keywordId");

  if (!keywordId) {
    return NextResponse.json({ error: "keywordId가 필요합니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reporter_blog_entries")
    .select("*")
    .eq("keyword_id", keywordId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { keyword_id, blog_url } = body;

  if (!keyword_id || !blog_url) {
    return NextResponse.json(
      { error: "keyword_id와 blog_url이 필요합니다." },
      { status: 400 }
    );
  }

  // 최대 10개 제한 확인
  const { count, error: countError } = await supabase
    .from("reporter_blog_entries")
    .select("*", { count: "exact", head: true })
    .eq("keyword_id", keyword_id);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  if ((count ?? 0) >= 10) {
    return NextResponse.json(
      { error: "URL은 키워드당 최대 10개까지 등록할 수 있습니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("reporter_blog_entries")
    .insert({ keyword_id, blog_url })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reporter_blog_entries")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (updates.current_rank !== undefined) {
    await saveReporterHistory(id, updates.current_rank);
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("reporter_blog_entries")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
