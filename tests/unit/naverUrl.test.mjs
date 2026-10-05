// 실행: npm test  (Node 22.18+ 의 TypeScript 타입 제거 기능으로 lib/*.ts 를 직접 import)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesBlogUrl,
  parseBlogRef,
  parseCafeRef,
  sameCafeArticle,
  cafeRefToUrl,
} from "../../lib/naverUrl.ts";

test("블로그 홈 등록: 같은 블로그의 글만 일치", () => {
  const home = "blog.naver.com/drkim";
  assert.equal(matchesBlogUrl("https://blog.naver.com/drkim/224181717584", home), true);
  assert.equal(matchesBlogUrl("https://m.blog.naver.com/drkim/224181717584", home), true);
  assert.equal(matchesBlogUrl("https://blog.naver.com/PostView.naver?blogId=drkim&amp;logNo=1", home), true);
  // 접두어만 같은 다른 블로그
  assert.equal(matchesBlogUrl("https://blog.naver.com/drkim2/224181717584", home), false);
  assert.equal(matchesBlogUrl("https://blog.naver.com/drkimchi/1", home), false);
  // 블로그가 아닌 사이트
  assert.equal(matchesBlogUrl("https://evil.tld/blog.naver.com/drkim/1", home), false);
  assert.equal(matchesBlogUrl("https://cafe.naver.com/drkim/1", home), false);
});

test("블로그 글 등록: 블로그 ID와 글 번호가 모두 같아야 일치", () => {
  const post = "https://blog.naver.com/x/22418";
  assert.equal(matchesBlogUrl("https://blog.naver.com/x/22418", post), true);
  assert.equal(matchesBlogUrl("https://m.blog.naver.com/x/22418?foo=1", post), true);
  // 글 번호가 접두어만 같은 다른 글
  assert.equal(matchesBlogUrl("https://blog.naver.com/x/224181717584", post), false);
  // 같은 글 번호, 다른 블로그
  assert.equal(matchesBlogUrl("https://blog.naver.com/y/22418", post), false);
});

test("블로그 URL 형식: 스킴 없음, http, www, logNo 쿼리", () => {
  assert.deepEqual(parseBlogRef("blog.naver.com/abc"), { blogId: "abc", logNo: null });
  assert.deepEqual(parseBlogRef("http://www.blog.naver.com/abc/12"), { blogId: "abc", logNo: "12" });
  assert.deepEqual(parseBlogRef("https://blog.naver.com/abc?Redirect=Log&logNo=77"), {
    blogId: "abc",
    logNo: "77",
  });
  assert.equal(parseBlogRef("https://blog.naver.com.evil.tld/abc/12"), null);
  assert.equal(parseBlogRef("not a url"), null);
});

test("카페 글: 카페와 글 번호 완전일치", () => {
  const target = parseCafeRef("https://cafe.naver.com/team/123");
  const eq = (link) => sameCafeArticle(parseCafeRef(link), target);
  assert.equal(eq("https://cafe.naver.com/team/123?art=ZXh0ZXJuYWw"), true);
  assert.equal(eq("https://m.cafe.naver.com/team/123"), true);
  assert.equal(eq("https://cafe.naver.com/TEAM/123"), true);
  // 글 번호가 접두어만 같은 다른 글
  assert.equal(eq("https://cafe.naver.com/team/1234"), false);
  assert.equal(eq("https://cafe.naver.com/team/12"), false);
  // 같은 글 번호, 다른 카페
  assert.equal(eq("https://cafe.naver.com/other/123"), false);
});

test("카페 URL 형식: 숫자 ID 경로, ArticleRead, 카페가 아닌 링크", () => {
  assert.deepEqual(parseCafeRef("https://cafe.naver.com/f-e/cafes/10050146/articles/456"), {
    cafe: null,
    clubId: "10050146",
    articleId: "456",
  });
  assert.deepEqual(parseCafeRef("https://m.cafe.naver.com/ca-fe/web/cafes/team/articles/9"), {
    cafe: "team",
    clubId: null,
    articleId: "9",
  });
  assert.deepEqual(
    parseCafeRef("https://cafe.naver.com/ArticleRead.nhn?clubid=10050146&amp;articleid=456"),
    { cafe: null, clubId: "10050146", articleId: "456" }
  );
  assert.equal(parseCafeRef("https://blog.naver.com/team/123"), null);
  assert.equal(parseCafeRef("https://cafe.naver.com/team"), null);
  assert.equal(parseCafeRef("https://cafe.naver.com.evil.tld/team/123"), null);
});

test("카페: 이름과 숫자 ID가 섞여 대조할 수 없으면 일치로 보지 않는다", () => {
  const byName = parseCafeRef("https://cafe.naver.com/team/456");
  const byId = parseCafeRef("https://cafe.naver.com/f-e/cafes/10050146/articles/456");
  const sameId = parseCafeRef("https://cafe.naver.com/ArticleRead.nhn?clubid=10050146&articleid=456");
  const otherId = parseCafeRef("https://cafe.naver.com/f-e/cafes/999/articles/456");
  assert.equal(sameCafeArticle(byName, byId), false);
  assert.equal(sameCafeArticle(byId, sameId), true);
  assert.equal(sameCafeArticle(byId, otherId), false);
  // 숫자 ID로 등록된 글의 카페 이름을 조회해 채운 뒤에는 이름 형식 링크와 대조된다
  const resolved = { ...byId, cafe: "team" };
  assert.equal(sameCafeArticle(resolved, byName), true);
  assert.equal(sameCafeArticle(resolved, parseCafeRef("https://cafe.naver.com/other/456")), false);
  // 양쪽에 숫자 ID가 있으면 이름보다 숫자 ID를 우선 비교
  assert.equal(sameCafeArticle(resolved, { cafe: "team", clubId: "999", articleId: "456" }), false);
  assert.equal(cafeRefToUrl(byName), "https://cafe.naver.com/team/456");
  assert.equal(cafeRefToUrl(byId), null);
});
