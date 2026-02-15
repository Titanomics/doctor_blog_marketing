import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { saveKeywordHistory } from "@/lib/saveHistory";

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

  return NextResponse.json(data);
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

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
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
    await saveKeywordHistory(id, updates.current_rank);
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
