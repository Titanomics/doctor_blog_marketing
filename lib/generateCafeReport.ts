import * as XLSX from "xlsx";

interface ReportKeyword {
  clientName: string;
  keyword: string;
  current_rank: number | null;
  previous_rank: number | null;
  post_url: string | null;
  post_title: string | null;
  matched_url: string | null;
  cafe_name?: string | null;
  author_name?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  published_at?: string | null;
}

function rankChange(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "";
  const diff = previous - current;
  if (diff > 0) return `▲${diff}`;
  if (diff < 0) return `▼${Math.abs(diff)}`;
  return "-";
}

// ISO → KST 'YYYY-MM-DD HH:mm' (간결)
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// ISO → KST 'YYYY-MM-DD'
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

export function generateCafeReport(keywords: ReportKeyword[], date: string): Buffer {
  const exposed = keywords.filter((k) => k.current_rank !== null);
  const unexposed = keywords.filter((k) => k.current_rank === null);

  // 화면 컬럼 순서 따라 정리
  const exposedRows = exposed.map((k) => ({
    브랜드명: k.clientName,
    키워드: k.keyword,
    포스팅제목: k.post_title ?? "",
    작성자: k.author_name ?? "",
    카페이름: k.cafe_name ?? "",
    현재순위: k.current_rank,
    이전순위: k.previous_rank ?? "",
    변동: rankChange(k.current_rank, k.previous_rank),
    노출URL: k.matched_url ?? "",
    포스팅URL: k.post_url ?? "",
    마지막갱신: fmtDateTime(k.updated_at),
    등록일: fmtDate(k.created_at),
    작성일: fmtDate(k.published_at),
  }));

  const unexposedRows = unexposed.map((k) => ({
    브랜드명: k.clientName,
    키워드: k.keyword,
    포스팅제목: k.post_title ?? "",
    작성자: k.author_name ?? "",
    카페이름: k.cafe_name ?? "",
    이전순위: k.previous_rank ?? "",
    변동: k.previous_rank !== null ? "순위권 밖" : "",
    포스팅URL: k.post_url ?? "",
    마지막갱신: fmtDateTime(k.updated_at),
    등록일: fmtDate(k.created_at),
    작성일: fmtDate(k.published_at),
  }));

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(
    exposedRows.length > 0 ? exposedRows : [{ 브랜드명: "", 키워드: "" }]
  );
  XLSX.utils.book_append_sheet(wb, ws1, `노출(${date})`);

  const ws2 = XLSX.utils.json_to_sheet(
    unexposedRows.length > 0 ? unexposedRows : [{ 브랜드명: "", 키워드: "" }]
  );
  XLSX.utils.book_append_sheet(wb, ws2, `미노출(${date})`);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf;
}
