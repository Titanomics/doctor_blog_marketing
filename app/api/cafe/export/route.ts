import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateCafeReport } from "@/lib/generateCafeReport";
import { getKSTDateString } from "@/lib/dateUtils";

export async function GET(request: NextRequest) {
  try {
    // clientId가 있으면 해당 브랜드만, 없으면 전체 브랜드 내보내기
    const clientId = request.nextUrl.searchParams.get("clientId");

    let clientQuery = supabase.from("cafe_clients").select("id, name");
    if (clientId) {
      clientQuery = clientQuery.eq("id", clientId);
    }
    const { data: clients } = await clientQuery;

    if (!clients || clients.length === 0) {
      return NextResponse.json({ error: "등록된 브랜드가 없습니다." }, { status: 400 });
    }

    const keywords: Array<{
      clientName: string;
      keyword: string;
      current_rank: number | null;
      previous_rank: number | null;
      post_url: string | null;
      post_title: string | null;
      matched_url: string | null;
      cafe_name: string | null;
      author_name: string | null;
      updated_at: string | null;
      created_at: string | null;
      published_at: string | null;
    }> = [];

    for (const client of clients) {
      const { data: kws } = await supabase
        .from("cafe_keywords")
        .select(
          "keyword, current_rank, previous_rank, post_url, post_title, matched_url, cafe_name, author_name, updated_at, created_at, published_at"
        )
        .eq("client_id", client.id);

      if (!kws) continue;
      for (const kw of kws) {
        keywords.push({ clientName: client.name, ...kw });
      }
    }

    const date = getKSTDateString();
    const excelBuffer = generateCafeReport(keywords, date);

    const brandSuffix = clientId ? `_${clients[0].name}` : "";
    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`카페_상위노출_리포트${brandSuffix}_${date}.xlsx`)}`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "엑셀 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
