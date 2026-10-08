// 미노출 키워드 자동 확인의 판정부 (네트워크·DB 없음 — 단위 테스트 대상).
// 상대 경로 import 만 쓴다: node --test 가 @/ 별칭을 모른다.
import type { ScanResultItem, ScanSummary } from "./mentionScanRun.ts";
import { PROMOTING_LEVELS } from "./mentionScan.ts";

export type AutoScanSide = "cafe" | "reporter";

export interface AutoScanRecord {
  keyword: string;
  sides: AutoScanSide[]; // 이 키워드가 미노출인 쪽
  scannedAt: string;
  summary: ScanSummary & { auto: true; sides: AutoScanSide[] };
  results: ScanResultItem[];
}

// 한 키워드의 결과를 한 줄로 요약한 것
export interface AutoScanVerdict {
  keyword: string;
  sides: AutoScanSide[];
  status: "found" | "none" | "unreadable"; // 우리 글 있음 / 없음 / 본문을 하나도 못 읽어 판단 불가
  bestRank: number | null;
  registered: boolean; // 있음일 때, 그 글이 대시보드에 등록된 우리 글인지
  registeredBrand: string | null;
  mentionLevel: string | null; // 있음일 때, 등록 글이 아니면 언급 성격 (main/switch/light/comment_only)
  title: string | null; // 있음일 때 그 글 제목
  link: string | null;
}

export function toVerdict(r: AutoScanRecord): AutoScanVerdict {
  const base = { keyword: r.keyword, sides: r.sides };
  const found = r.results
    .filter((it) => it.registered || (it.analysis && PROMOTING_LEVELS.includes(it.analysis.level)))
    .sort((a, b) => a.rank - b.rank);
  if (found.length > 0) {
    const best = found[0];
    return {
      ...base,
      status: "found",
      bestRank: best.rank,
      registered: !!best.registered,
      registeredBrand: best.registered,
      mentionLevel: best.registered ? null : best.analysis?.level ?? null,
      title: best.title,
      link: best.link,
    };
  }
  const readable = r.results.filter((it) => it.kind !== "web");
  const status = readable.length > 0 && r.summary.analyzed === 0 ? "unreadable" : "none";
  return { ...base, status, bestRank: null, registered: false, registeredBrand: null, mentionLevel: null, title: null, link: null };
}

