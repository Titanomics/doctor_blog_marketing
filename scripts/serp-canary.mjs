// 러너 IP 차단율 측정 (카나리).
// GitHub Actions 러너에서 네이버 통합검색을 배치와 같은 간격으로 호출해,
// 정상 응답 비율과 응답 시간을 잰다. DB를 읽지도 쓰지도 않는다.
//
// 배치를 Vercel 함수에서 러너로 옮기기 전에, 러너 IP 대역이 네이버에 막히는지 확인하는 용도.
// 실행: node scripts/serp-canary.mjs [요청 수=60] [간격 초=10]
//
// 공개 저장소라 실제 고객 키워드는 쓰지 않는다. 아래는 일반적인 검색어다.

import fs from "node:fs";
import { parseViewSection, parseSmartBlocks, classifySerp } from "../lib/parseNaver.ts";

const KEYWORDS = [
  "임플란트 가격", "허리디스크 증상", "다이어트 보조제 추천", "비타민D 효능", "오메가3 추천",
  "탈모 샴푸 추천", "무릎 통증 원인", "역류성 식도염 증상", "대상포진 초기증상", "혈압 정상수치",
  "유산균 추천", "콜라겐 효능", "수면 영양제", "눈 영양제 추천", "간 영양제 추천",
  "치아 미백 가격", "라식 라섹 차이", "보톡스 가격", "피부과 여드름 치료", "건강검진 항목",
  "독감 예방접종 시기", "갑상선 기능 저하증 증상", "고지혈증 약", "통풍 증상", "빈혈 증상",
  "마그네슘 효능", "프로폴리스 효능", "홍삼 효능", "단백질 보충제 추천", "관절 영양제 추천",
];

const count = Math.max(1, parseInt(process.argv[2] ?? "60", 10) || 60);
const intervalS = Math.max(1, parseFloat(process.argv[3] ?? "10") || 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(keyword) {
  const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(keyword)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { outcome: `http_${res.status}`, ms, results: 0 };
    const html = await res.text();
    const results = parseViewSection(html).length + parseSmartBlocks(html).length;
    const state = classifySerp(html, results); // ok / empty / invalid
    return { outcome: state, ms: Date.now() - started, results, bytes: html.length };
  } catch (err) {
    return { outcome: err?.name === "TimeoutError" ? "timeout" : "network_error", ms: Date.now() - started, results: 0 };
  }
}

const tally = {};
const times = [];
let firstFailureAt = null;
let consecutiveFail = 0;
let maxConsecutiveFail = 0;
const startedAt = Date.now();

for (let i = 0; i < count; i++) {
  if (i > 0) await sleep(intervalS * 1000);
  const r = await probe(KEYWORDS[i % KEYWORDS.length]);
  tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
  const good = r.outcome === "ok";
  if (good) {
    times.push(r.ms);
    consecutiveFail = 0;
  } else {
    firstFailureAt ??= i + 1;
    maxConsecutiveFail = Math.max(maxConsecutiveFail, ++consecutiveFail);
  }
  console.log(`${String(i + 1).padStart(3)}/${count} ${r.outcome.padEnd(14)} ${String(r.ms).padStart(5)}ms 결과 ${r.results}건`);
}

times.sort((a, b) => a - b);
const okCount = tally.ok ?? 0;
const summary = {
  requests: count,
  intervalSeconds: intervalS,
  ok: okCount,
  okRate: +(okCount / count).toFixed(3),
  outcomes: tally,
  firstFailureAtRequest: firstFailureAt,
  maxConsecutiveFailures: maxConsecutiveFail,
  medianMs: times.length ? times[times.length >> 1] : null,
  p95Ms: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : null,
  elapsedMinutes: +((Date.now() - startedAt) / 60000).toFixed(1),
};
console.log("\nSUMMARY " + JSON.stringify(summary));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "### 러너 IP 차단율 측정",
      "",
      `- 요청 ${count}건, 간격 ${intervalS}초, 소요 ${summary.elapsedMinutes}분`,
      `- 정상 응답 **${okCount}/${count}** (${(summary.okRate * 100).toFixed(1)}%)`,
      `- 결과 분류: \`${JSON.stringify(tally)}\``,
      `- 첫 실패 위치: ${firstFailureAt ?? "없음"}, 최대 연속 실패: ${maxConsecutiveFail}`,
      `- 응답 시간: 중앙값 ${summary.medianMs ?? "-"}ms, 95% ${summary.p95Ms ?? "-"}ms`,
      "",
    ].join("\n")
  );
}

// 정상 응답이 90% 미만이면 실패로 표시해 눈에 띄게 한다
process.exit(summary.okRate >= 0.9 ? 0 : 1);
