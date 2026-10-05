import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrend, recentKstDates, toDayValues } from "../../lib/trend.ts";

// 하루 값: 양수 = 순위 / 0 = 미노출 / null = 수집 기록 없음
const rep = (v, n) => Array(n).fill(v);

test("14일 중 80% 이상 7위 이내면 상위권 유지", () => {
  assert.equal(classifyTrend([...rep(3, 12), 9, 3]).status, "top_hold");
  assert.equal(classifyTrend([...rep(0, 16), ...rep(5, 14)]).status, "top_hold");
});

test("수집 기록이 10일 미만이면 판정하지 않는다", () => {
  const r = classifyTrend([...rep(null, 21), ...rep(2, 9)]);
  assert.equal(r.status, "insufficient");
  assert.equal(r.observed, 9);
});

test("수집 기록이 없는 날은 분모에서 빠진다", () => {
  // 14일 중 4일은 기록 없음, 나머지 10일은 전부 3위 → 10/10
  const r = classifyTrend([3, null, 3, 3, null, 3, 3, null, 3, 3, null, 3, 3, 3]);
  assert.equal(r.status, "top_hold");
  assert.equal(r.observed, 10);
  assert.equal(r.topDays, 10);
});

test("최근에 상위권이었다가 지금 밀려났으면 이탈", () => {
  assert.equal(classifyTrend([...rep(4, 9), 12, 15, 0, 20, 18]).status, "top_drop");
  // 미노출로 떨어진 경우도 이탈
  assert.equal(classifyTrend([...rep(0, 5), ...rep(6, 6), 6, 6, 0]).status, "top_drop");
});

test("원래 상위권이 아니었으면 이탈이 아니다", () => {
  assert.equal(classifyTrend(rep(15, 14)).status, "none");
  assert.equal(classifyTrend([...rep(15, 13), 20]).status, "none");
});

test("기간 내내 미노출이면 장기 미노출", () => {
  assert.equal(classifyTrend(rep(0, 30)).status, "long_unexposed");
  // 한 번이라도 순위가 있었으면 장기 미노출이 아니다
  assert.equal(classifyTrend([12, ...rep(0, 29)]).status, "none");
});

test("날짜 배열은 KST 기준이고 오래된 날부터", () => {
  // 2026-10-05 16:00 UTC = 2026-10-06 01:00 KST
  const dates = recentKstDates(3, Date.UTC(2026, 9, 5, 16, 0));
  assert.deepEqual(dates, ["2026-10-04", "2026-10-05", "2026-10-06"]);
});

test("history 행을 날짜 배열에 맞춘다: 미노출은 0, 기록 없는 날은 null", () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const rows = [
    { tracked_date: "2026-10-01", rank: 4 },
    { tracked_date: "2026-10-03", rank: null },
  ];
  assert.deepEqual(toDayValues(dates, rows), [4, null, 0]);
});
