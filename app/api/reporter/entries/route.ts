import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveReporterHistory } from "@/lib/saveReporterHistory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
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

// PATCH로 변경 가능한 필드 화이트리스트
// (id/keyword_id/created_at은 변경 금지)
const ALLOWED_PATCH_FIELDS = new Set<string>([
  "blog_url",
  "current_rank",
  "previous_rank",
  "matched_title",
  "matched_url",
  "smart_block_name",
  "smart_block_rank",
  "updated_at",
]);

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...rawUpdates } = body;

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  // 화이트리스트 필드만 통과
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawUpdates)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 필드가 없습니다." }, { status: 400 });
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
    await saveReporterHistory(id, updates.current_rank as number | null);
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
