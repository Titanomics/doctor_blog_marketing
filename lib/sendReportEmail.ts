import nodemailer from "nodemailer";

export interface ReporterStatusChange {
  clientName: string;
  keyword: string;
  blogUrl: string;
  previousRank: number | null;
  currentRank: number | null;
}

interface ReporterChanges {
  newlyExposed: ReporterStatusChange[];
  newlyUnexposed: ReporterStatusChange[];
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function buildReporterSection(changes: ReporterChanges): string {
  const { newlyExposed, newlyUnexposed } = changes;
  if (newlyExposed.length === 0 && newlyUnexposed.length === 0) {
    return "\n[블로그기자단 상태 변화]\n변화 없음\n";
  }

  let section = "\n[블로그기자단 상태 변화]\n";

  if (newlyExposed.length > 0) {
    section += `\n■ 미노출 → 노출 (${newlyExposed.length}건)\n`;
    for (const item of newlyExposed) {
      section += `  • [${item.clientName}] "${item.keyword}" ${shortUrl(item.blogUrl)} → ${item.currentRank}위\n`;
    }
  }

  if (newlyUnexposed.length > 0) {
    section += `\n■ 노출 → 미노출 (${newlyUnexposed.length}건)\n`;
    for (const item of newlyUnexposed) {
      section += `  • [${item.clientName}] "${item.keyword}" ${shortUrl(item.blogUrl)} (이전 ${item.previousRank}위)\n`;
    }
  }

  return section;
}

export interface CafeKeywordSummary {
  clientName: string;
  keyword: string;
  current_rank: number | null;
  previous_rank: number | null;
}

function buildCafeSummary(keywords: CafeKeywordSummary[]): string {
  const risen: string[] = [];
  const dropped: string[] = [];
  const newlyExposed: string[] = [];
  const newlyOut: string[] = [];

  for (const k of keywords) {
    const { current_rank: cur, previous_rank: prev } = k;
    const label = `[${k.clientName}] "${k.keyword}"`;

    if (cur !== null && prev === null) {
      newlyExposed.push(`  • ${label} → ${cur}위 (신규 진입)`);
    } else if (cur === null && prev !== null) {
      newlyOut.push(`  • ${label} (이전 ${prev}위 → 순위권 밖)`);
    } else if (cur !== null && prev !== null && cur < prev) {
      risen.push(`  • ${label} ${prev}위 → ${cur}위 (▲${prev - cur})`);
    } else if (cur !== null && prev !== null && cur > prev) {
      dropped.push(`  • ${label} ${prev}위 → ${cur}위 (▼${cur - prev})`);
    }
  }

  if (risen.length === 0 && dropped.length === 0 && newlyExposed.length === 0 && newlyOut.length === 0) {
    return "\n[카페 순위 변동]\n변동 없음\n";
  }

  let section = "\n[카페 순위 변동]\n";
  if (newlyExposed.length > 0) section += `\n■ 신규 진입 (${newlyExposed.length}건)\n${newlyExposed.join("\n")}\n`;
  if (risen.length > 0) section += `\n■ 순위 상승 (${risen.length}건)\n${risen.join("\n")}\n`;
  if (dropped.length > 0) section += `\n■ 순위 하락 (${dropped.length}건)\n${dropped.join("\n")}\n`;
  if (newlyOut.length > 0) section += `\n■ 순위권 밖 (${newlyOut.length}건)\n${newlyOut.join("\n")}\n`;
  return section;
}

export async function sendReportEmail(
  excelBuffer: Buffer,
  date: string,
  reporterChanges?: ReporterChanges,
  cafeKeywords?: CafeKeywordSummary[]
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const cafeSection = cafeKeywords
    ? buildCafeSummary(cafeKeywords)
    : "";

  const reporterSection = reporterChanges
    ? buildReporterSection(reporterChanges)
    : "";

  await transporter.sendMail({
    from: `기린컴퍼니 리포트 <${process.env.GMAIL_USER}>`,
    to: process.env.REPORT_EMAIL,
    subject: `[기린컴퍼니] 카페 상위노출 리포트 ${date}`,
    text: `안녕하세요.\n\n${date} 기준 카페 상위노출 추적 리포트를 첨부합니다.\n\n- 노출 시트: 노출 중인 키워드와 순위\n- 미노출 시트: 미노출 키워드 목록${cafeSection}${reporterSection}`,
    attachments: [
      {
        filename: `카페_상위노출_리포트_${date}.xlsx`,
        content: excelBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}
