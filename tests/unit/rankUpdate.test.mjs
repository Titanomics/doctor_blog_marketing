import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPreviousRank } from "../../lib/rankUpdate.ts";

// 기준 시각: 2026-10-06 14:00 KST
const now = Date.UTC(2026, 9, 6, 5, 0);

test("어제 갱신된 행: 현재 순위가 직전 순위가 된다", () => {
  const row = { current_rank: 5, previous_rank: 9, updated_at: "2026-10-05T06:00:00+09:00" };
  assert.equal(nextPreviousRank(row, now), 5);
});

test("오늘 이미 갱신된 행: 직전 순위를 유지한다 (같은 날 재수집으로 변화가 지워지지 않게)", () => {
  // 새벽 배치가 8위 → 3위로 기록한 뒤, 낮에 수동 새로고침
  const row = { current_rank: 3, previous_rank: 8, updated_at: "2026-10-06T05:40:00+09:00" };
  assert.equal(nextPreviousRank(row, now), 8);
});

test("KST 자정 경계: UTC로는 같은 날이어도 KST 날짜가 다르면 넘긴다", () => {
  // 10/5 23:50 KST 갱신 → 10/6 00:10 KST 재수집
  const row = { current_rank: 4, previous_rank: 7, updated_at: "2026-10-05T23:50:00+09:00" };
  assert.equal(nextPreviousRank(row, Date.UTC(2026, 9, 5, 15, 10)), 4);
});

test("미노출(null)도 그대로 넘어간다", () => {
  assert.equal(nextPreviousRank({ current_rank: null, previous_rank: 2, updated_at: "2026-10-05T06:00:00+09:00" }, now), null);
  assert.equal(nextPreviousRank({ current_rank: 6, previous_rank: null, updated_at: "2026-10-06T06:00:00+09:00" }, now), null);
});

test("갱신 시각이 없거나 잘못된 행: 현재 순위를 넘긴다", () => {
  assert.equal(nextPreviousRank({ current_rank: 6, previous_rank: 1, updated_at: null }, now), 6);
  assert.equal(nextPreviousRank({ current_rank: 6, previous_rank: 1, updated_at: "not a date" }, now), 6);
});
