import test from "node:test";
import assert from "node:assert/strict";
import { toVerdict } from "../../lib/autoScanVerdict.ts";

const item = (rank, extra = {}) => ({ rank, kind: "cafe", title: `t${rank}`, link: `https://cafe.naver.com/x/${rank}`, note: null, analysis: null, registered: null, ...extra });
const analysis = (level) => ({ level, label: level, count: 1, commentCount: 0, inTitle: false, firstPosition: 0.1, recommendCue: false, negativeCue: false, snippets: [] });
const record = (results, analyzed) => ({ keyword: "k", sides: ["cafe"], scannedAt: "", summary: { total: results.length, analyzed, unreadable: 0, mentioned: 0, promoting: 0, registered: 0, bestRank: null, ranks: [], auto: true, sides: ["cafe"] }, results });

test("등록된 우리 글이 있으면 있음 + 그 순위", () => {
  const v = toVerdict(record([item(1), item(4, { registered: "솔커트" }), item(7, { analysis: analysis("main") })], 3));
  assert.equal(v.status, "found");
  assert.equal(v.bestRank, 4);
  assert.equal(v.registered, true);
  assert.equal(v.registeredBrand, "솔커트");
});

test("등록 글은 없지만 제품을 알리는 언급 글이 있으면 미등록 언급으로 있음", () => {
  const v = toVerdict(record([item(2, { analysis: analysis("passing") }), item(5, { analysis: analysis("light") })], 2));
  assert.equal(v.status, "found");
  assert.equal(v.bestRank, 5);
  assert.equal(v.registered, false);
  assert.equal(v.mentionLevel, "light");
});

test("스쳐가는 언급만 있으면 없음", () => {
  const v = toVerdict(record([item(2, { analysis: analysis("passing") }), item(3, { analysis: analysis("none") })], 2));
  assert.equal(v.status, "none");
  assert.equal(v.bestRank, null);
});

test("본문을 하나도 못 읽었으면 판단 불가", () => {
  const v = toVerdict(record([item(1, { note: "회원 전용" }), item(2, { note: "회원 전용" })], 0));
  assert.equal(v.status, "unreadable");
});

test("외부 사이트만 있고 읽을 글이 없으면 없음", () => {
  const v = toVerdict(record([item(1, { kind: "web", note: "외부" })], 0));
  assert.equal(v.status, "none");
});
