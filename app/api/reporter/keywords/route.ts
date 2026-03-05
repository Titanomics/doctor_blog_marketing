import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ error: "clientId가 필요합니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reporter_keywords")
    .select("*, entries:reporter_blog_entries(*)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

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

  // 띄어쓰기 무시 중복 체크
  const { data: existing } = await supabase
    .from("reporter_keywords")
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
    .from("reporter_keywords")
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
  const { id, keyword } = body;

  if (!id || !keyword) {
    return NextResponse.json({ error: "id와 keyword가 필요합니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reporter_keywords")
    .update({ keyword })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("reporter_keywords")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
