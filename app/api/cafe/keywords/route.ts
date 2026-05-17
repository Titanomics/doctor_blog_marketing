import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveCafeHistory } from "@/lib/saveCafeHistory";

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
    .from("cafe_keywords")
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
  const { client_id, keyword, post_url, post_title, author_name, cafe_name } = body;

  if (!client_id || !keyword) {
    return NextResponse.json(
      { error: "client_id와 keyword가 필요합니다." },
      { status: 400 }
    );
  }

  if (!post_url && !post_title) {
    return NextResponse.json(
      { error: "포스팅 URL 또는 제목 중 하나는 입력해주세요." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("cafe_keywords")
    .insert({
      client_id,
      keyword,
      post_url: post_url ?? null,
      post_title: post_title ?? null,
      author_name: author_name ?? null,
      cafe_name: cafe_name?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

// PATCH로 변경 가능한 필드 화이트리스트
// (id/client_id/created_at은 변경 금지, 그 외 임의 컬럼 주입 차단)
// NOTE: priority 필드 부재는 의도적 — 카페는 별점 UI를 노출하지 않음 (블로그 모드만).
//        UI MainPanel.tsx에서 priority 변경은 isBlog 분기 안에서만 호출.
const ALLOWED_PATCH_FIELDS = new Set<string>([
  "keyword",
  "post_url",
  "post_title",
  "author_name",
  "cafe_name",
  "current_rank",
  "previous_rank",
  "matched_title",
  "matched_url",
  "smart_block_name",
  "smart_block_rank",
  "is_reply",
  "reply_since",
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
    .from("cafe_keywords")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (updates.current_rank !== undefined) {
    await saveCafeHistory(id, updates.current_rank as number | null);
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const { error } = await supabase.from("cafe_keywords").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
