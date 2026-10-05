import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAge, validRecords, checkpointOf, publishWeekStart } from "../../lib/ageBand.ts";

// 발행일 2026-09-01 기준으로 D+n 날짜를 만든다
const PUB = "2026-09-01";
const d = (n) => new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
const rec = (n, rank) => ({ date: d(n), rank });
const states = (s) => s.cells.map((c) => c.state);

test("주차: D+0~6이 1주차, D+7~13이 2주차", () => {
  assert.equal(summarizeAge(PUB, [], d(0)).week, 1);
  assert.equal(summarizeAge(PUB, [], d(6)).week, 1);
  assert.equal(summarizeAge(PUB, [], d(7)).week, 2);
  assert.equal(summarizeAge(PUB, [], d(27)).week, 4);
  assert.equal(summarizeAge(PUB, [], d(28)).week, 5);
});

test("띠 한 칸 = 그 주에 수집한 날 중 노출된 날", () => {
  const records = [
    // 1주차: 7일 수집, 노출 0
    ...[0, 1, 2, 3, 4, 5, 6].map((n) => rec(n, null)),
    // 2주차: 6일 수집, 2일 노출 → 일부
    rec(7, null), rec(8, null), rec(9, 12), rec(10, null), rec(11, null), rec(12, 15),
    // 3주차: 수집 기록 없음
    // 4주차: 3일 수집, 3일 노출
    rec(21, 5), rec(22, 4), rec(23, 4),
  ];
  const s = summarizeAge(PUB, records, d(23));
  assert.deepEqual(states(s), ["none", "partial", "no_data", "full"]);
  assert.deepEqual([s.cells[1].observedDays, s.cells[1].exposedDays], [6, 2]);
  assert.equal(s.firstExposureWeek, 2);
  assert.equal(s.firstExposureDate, d(9));
});

test("2주차 이후에 처음 뜬 글: 발행 직후부터 수집했으면 first", () => {
  const records = [...Array.from({ length: 16 }, (_, n) => rec(n, null)), rec(16, 9)];
  const s = summarizeAge(PUB, records, d(16));
  assert.equal(s.todayEvent, "first");
  assert.equal(s.firstExposureWeek, 3);
  assert.equal(s.observedFromStart, true);
});

test("처음 노출 주차는 그 전 주들에 수집 기록이 있을 때만 단정한다", () => {
  // 1·2주차 수집(미노출) → 3주차에 노출: 단정 가능
  const ok = summarizeAge(PUB, [rec(1, null), rec(8, null), rec(15, 6)], d(15));
  assert.equal(ok.firstExposureWeek, 3);
  assert.equal(ok.firstExposureConfirmed, true);
  // 1주차만 수집하고 2주차 기록이 비어 있음 → 2주차에 떴다가 내려갔을 수 있어 단정 불가
  const gap = summarizeAge(PUB, [rec(1, null), rec(15, 6)], d(15));
  assert.equal(gap.firstExposureWeek, 3);
  assert.equal(gap.firstExposureConfirmed, false);
});

test("수집이 늦게 시작된 글의 첫 노출은 first_seen (그 전에 떴었는지는 모름)", () => {
  const s = summarizeAge(PUB, [rec(30, null), rec(31, 7)], d(31));
  assert.equal(s.todayEvent, "first_seen");
  assert.equal(s.observedFromStart, false);
  // 수집 전 주차는 미노출이 아니라 기록 없음
  assert.deepEqual(states(s).slice(0, 4), ["no_data", "no_data", "no_data", "no_data"]);
});

test("내려갔다가 다시 뜨면 reentry, 뜨다가 내려가면 drop, 계속 떠 있으면 사건 없음", () => {
  assert.equal(summarizeAge(PUB, [rec(1, 3), rec(2, null), rec(3, null), rec(4, 6)], d(4)).todayEvent, "reentry");
  assert.equal(summarizeAge(PUB, [rec(1, 3), rec(2, 4), rec(3, null)], d(3)).todayEvent, "drop");
  assert.equal(summarizeAge(PUB, [rec(1, 3), rec(2, 4), rec(3, 4)], d(3)).todayEvent, null);
  assert.equal(summarizeAge(PUB, [rec(1, null), rec(2, null)], d(2)).todayEvent, null);
});

test("수집이 하루뿐이면 사건으로 치지 않는다 (비교할 이전 수집이 없음)", () => {
  assert.equal(summarizeAge(PUB, [rec(40, 5)], d(40)).todayEvent, null);
});

test("과거 기록의 '앞뒤는 노출인데 하루만 미노출'은 수집 실패로 보고 뺀다", () => {
  const records = [rec(1, 3), rec(2, null), rec(3, 4)];
  assert.equal(validRecords(records).length, 2);
  // 그래서 재진입으로 잘못 표시되지 않는다
  assert.equal(summarizeAge(PUB, records, d(3)).todayEvent, null);
  // 이틀 연속 미노출은 실제 미노출로 본다
  assert.equal(validRecords([rec(1, 3), rec(2, null), rec(3, null), rec(4, 4)]).length, 4);
});

test("실패를 따로 기록하기 시작한 날(2026-10-06) 이후의 하루 미노출은 그대로 인정한다", () => {
  const records = [
    { date: "2026-10-06", rank: 3 },
    { date: "2026-10-07", rank: null },
    { date: "2026-10-08", rank: 4 },
  ];
  assert.equal(validRecords(records).length, 3);
  assert.equal(summarizeAge("2026-10-01", records, "2026-10-08").todayEvent, "reentry");
});

test("발행일 이전의 기록은 이 글의 기록으로 치지 않는다", () => {
  const s = summarizeAge(PUB, [{ date: "2026-08-20", rank: 2 }, rec(1, null)], d(1));
  assert.equal(s.everExposed, false);
  assert.equal(s.observedSince, d(1));
});

test("점검일과 발행 주", () => {
  assert.equal(checkpointOf(14), 14);
  assert.equal(checkpointOf(15), null);
  assert.equal(checkpointOf(42), 42); // 6주차까지 추적
  assert.equal(checkpointOf(49), null);
  assert.equal(publishWeekStart("2026-09-09"), "2026-09-07"); // 수요일 → 그 주 월요일
  assert.equal(publishWeekStart("2026-09-07"), "2026-09-07");
  assert.equal(publishWeekStart("2026-09-13"), "2026-09-07"); // 일요일
});
