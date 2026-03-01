import nodemailer from "nodemailer";

export async function sendReportEmail(excelBuffer: Buffer, date: string) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `기린컴퍼니 리포트 <${process.env.GMAIL_USER}>`,
    to: process.env.REPORT_EMAIL,
    subject: `[기린컴퍼니] 카페 상위노출 리포트 ${date}`,
    text: `안녕하세요.\n\n${date} 기준 카페 상위노출 추적 리포트를 첨부합니다.\n\n- 노출 시트: 노출 중인 키워드와 순위\n- 미노출 시트: 미노출 키워드 목록`,
    attachments: [
      {
        filename: `카페_상위노출_리포트_${date}.xlsx`,
        content: excelBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}
