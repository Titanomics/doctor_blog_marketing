import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveKeywordHistory } from "@/lib/saveHistory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json(
      { error: "clientId가 필요합니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("keywords")
    .select("*")
    .eq("client_id", clientId)
    .order("keyword", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { client_id, keyword } = body;

  if (!client_id || !keyword) {
    return NextResponse.json(
      { error: "client_id와 keyword가 필요합니다." },
      { status: 400 }
    );
  }

  // 띄어쓰기 무시 중복 체크
  const { data: existing } = await supabase
    .from("keywords")
    .select("keyword")
    .eq("client_id", client_id);

  const normalize = (s: string) => s.replace(/\s/g, "");
  const isDuplicate = (existing ?? []).some(
    (row) => normalize(row.keyword) === normalize(keyword)
  );
  if (isDuplicate) {
    return NextResponse.json(
      { error: "이미 등록된 키워드입니다." },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("keywords")
    .insert({ client_id, keyword })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

// PATCH로 변경 가능한 필드 화이트리스트
// (id/client_id/created_at은 변경 금지, 그 외 임의 컬럼 주입 차단)
const ALLOWED_PATCH_FIELDS = new Set<string>([
  "keyword",
  "priority",
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
    .from("keywords")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 순위 업데이트 시 히스토리 저장
  if (updates.current_rank !== undefined) {
    await saveKeywordHistory(id, updates.current_rank as number | null);
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const { error } = await supabase.from("keywords").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
