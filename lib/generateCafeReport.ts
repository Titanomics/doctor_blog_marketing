import * as XLSX from "xlsx";

interface ReportKeyword {
  clientName: string;
  keyword: string;
  current_rank: number | null;
  post_url: string | null;
  post_title: string | null;
  matched_url: string | null;
}

export function generateCafeReport(keywords: ReportKeyword[], date: string): Buffer {
  const exposed = keywords.filter((k) => k.current_rank !== null);
  const unexposed = keywords.filter((k) => k.current_rank === null);

  const exposedRows = exposed.map((k) => ({
    브랜드명: k.clientName,
    키워드: k.keyword,
    순위: k.current_rank,
    노출URL: k.matched_url ?? "",
    포스팅URL: k.post_url ?? "",
    포스팅제목: k.post_title ?? "",
  }));

  const unexposedRows = unexposed.map((k) => ({
    브랜드명: k.clientName,
    키워드: k.keyword,
    포스팅URL: k.post_url ?? "",
    포스팅제목: k.post_title ?? "",
  }));

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(
    exposedRows.length > 0 ? exposedRows : [{ 브랜드명: "", 키워드: "", 순위: "", 노출URL: "", 포스팅URL: "", 포스팅제목: "" }]
  );
  XLSX.utils.book_append_sheet(wb, ws1, `노출(${date})`);

  const ws2 = XLSX.utils.json_to_sheet(
    unexposedRows.length > 0 ? unexposedRows : [{ 브랜드명: "", 키워드: "", 포스팅URL: "", 포스팅제목: "" }]
  );
  XLSX.utils.book_append_sheet(wb, ws2, `미노출(${date})`);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf;
}
