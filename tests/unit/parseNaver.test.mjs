// 실제 네이버 통합검색 HTML(tests/fixtures/serp, 2026-10-05 수집, script/style 제거본)로
// 파서와 검색 화면 판정을 고정한다. 네이버가 마크업을 바꾸면 여기서 먼저 깨져야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseViewSection,
  parseSmartBlocks,
  parseReplies,
  classifySerp,
} from "../../lib/parseNaver.ts";
import { matchesBlogUrl, parseCafeRef } from "../../lib/naverUrl.ts";

const load = (name) =>
  fs.readFileSync(new URL(`../fixtures/serp/${name}.html`, import.meta.url), "utf8");

test("팥순이 다이어트 부작용: 결과 19건, 대상 글은 7번째", () => {
  const html = load("patsuni-diet");
  const results = parseViewSection(html);
  assert.equal(results.length, 19);
  assert.deepEqual(
    results.map((r) => r.rank),
    results.map((_, i) => i + 1)
  );
  const found = results.find((r) =>
    matchesBlogUrl(r.link, "https://blog.naver.com/fgrespond/224411376056")
  );
  assert.equal(found?.rank, 7);
  assert.equal(found?.title, "팥순이 다이어트 부작용 효과 내돈내산 후기");
  assert.equal(classifySerp(html, results.length), "ok");
});

test("제목에 '새 창 열림' 문구가 남지 않는다", () => {
  for (const name of ["patsuni-diet", "albumin-reco", "daegu-heart"]) {
    for (const r of parseViewSection(load(name))) {
      assert.ok(!r.title.includes("새 창 열림"), `${name}: ${r.title}`);
      assert.ok(r.title.length >= 3);
    }
  }
});

test("알부민 추천: 블로그·카페 글이 섞여 나오고 카페 링크를 식별할 수 있다", () => {
  const results = parseViewSection(load("albumin-reco"));
  assert.equal(results.length, 19);
  const cafes = results.filter((r) => parseCafeRef(r.link));
  assert.equal(cafes.length, 4);
  assert.deepEqual(parseCafeRef(results[4].link), {
    cafe: "move79",
    clubId: null,
    articleId: "5970264",
  });
});

test("대구심장내과: 결과 20건, 꼬리글 4건", () => {
  const html = load("daegu-heart");
  assert.equal(parseViewSection(html).length, 20);
  assert.equal(parseReplies(html).length, 4);
});

test("현재 화면에는 ugc 스마트블록이 없다 (있으면 파서 점검 필요)", () => {
  for (const name of ["patsuni-diet", "albumin-reco", "daegu-heart"]) {
    assert.equal(parseSmartBlocks(load(name)).length, 0, name);
  }
});

test("검색 결과가 없는 정상 페이지는 empty", () => {
  const html = load("no-result");
  assert.equal(parseViewSection(html).length, 0);
  assert.equal(classifySerp(html, 0), "empty");
});

test("검색 페이지가 아니면 invalid (차단·오류 페이지)", () => {
  assert.equal(classifySerp("<html><body>비정상적인 접근이 감지되었습니다</body></html>", 0), "invalid");
  assert.equal(classifySerp("", 0), "invalid");
});

test("결과의 절반만 읽히면 invalid (일부 항목만 마크업이 바뀐 경우)", () => {
  // 앞쪽 10개 항목만 파서가 못 읽게 만든다 → 순위가 당겨진 '그럴듯한 틀린 결과'
  let n = 0;
  const partial = load("patsuni-diet").replaceAll("headline1", (m) => (n++ < 10 ? "headlineX" : m));
  const results = parseViewSection(partial);
  assert.ok(results.length > 0 && results.length < 19 * 0.7, `읽은 결과 ${results.length}건`);
  assert.equal(classifySerp(partial, results.length), "invalid");
});

test("결과 영역은 있는데 하나도 못 읽으면 invalid (마크업 변경)", () => {
  // 실제 페이지에서 파서가 의존하는 속성만 바꿔 '읽을 수 없는' 상황을 만든다
  const broken = load("patsuni-diet").replaceAll("data-heatmap-target", "data-renamed");
  const count = parseViewSection(broken).length + parseSmartBlocks(broken).length;
  assert.equal(count, 0);
  assert.equal(classifySerp(broken, count), "invalid");
});
