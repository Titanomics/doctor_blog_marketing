import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeMentions, extractBlogContent, htmlToText, termPattern } from "../../lib/mentionScan.ts";

const TERMS = ["솔커트", "테르피노"];
const post = (title, body, comments = []) => ({ title, body, comments });
const filler = (n) => Array(n).fill("오늘은 다이어트 이야기를 해볼게요. 식단과 운동을 꾸준히 했어요.").join("\n");

test("실제 글: 경쟁 제품 후기로 시작해 중간부터 우리 제품으로 넘어가는 글은 전환형", () => {
  const fx = JSON.parse(fs.readFileSync(new URL("../fixtures/posts/blog-switch-example.json", import.meta.url), "utf8"));
  const a = analyzeMentions({ title: fx.title, body: fx.body, comments: [] }, TERMS);
  assert.equal(a.level, "switch");
  assert.equal(a.inTitle, false);
  assert.equal(a.count, 10);
  assert.ok(a.firstPosition > 0.5 && a.firstPosition < 0.6, `처음 등장 위치 ${a.firstPosition}`);
  assert.equal(a.recommendCue, true);
  assert.equal(a.negativeCue, false); // "팥순이 부작용"은 경쟁 제품 이야기 — 우리 제품의 부정 표현으로 잡으면 안 된다
  assert.equal(a.snippets.length, 3);
});

test("제목에 제품명이 있으면 제품 글", () => {
  const a = analyzeMentions(post("솔커트 한 달 먹어본 후기", `${filler(5)}\n솔커트를 먹었어요.`), TERMS);
  assert.equal(a.level, "main");
  assert.equal(a.inTitle, true);
});

test("앞부분부터 여러 번 다루면 제품 글", () => {
  const body = `솔커트를 먹기 시작했어요.\n${filler(3)}\n솔커트는 액상이에요.\n${filler(3)}\n솔커트 추천해요.`;
  assert.equal(analyzeMentions(post("다이어트 일기", body), TERMS).level, "main");
});

test("1~2번 언급 + 추천 표현은 짧은 추천, 표현이 없으면 스쳐 지나간 언급", () => {
  const reco = analyzeMentions(post("다이어트 일기", `${filler(6)}\n요즘은 솔커트 추천받아서 먹고 있어요.`), TERMS);
  assert.equal(reco.level, "light");
  const pass = analyzeMentions(post("다이어트 일기", `${filler(6)}\n친구가 솔커트라는 걸 말하더라구요.\n${filler(6)}`), TERMS);
  assert.equal(pass.level, "passing");
});

test("본문에는 없고 댓글에만 있으면 댓글에서 언급", () => {
  const a = analyzeMentions(post("다이어트 뭐 드세요?", filler(4), ["저는 솔커트 먹어요", "저도요"]), TERMS);
  assert.equal(a.level, "comment_only");
  assert.equal(a.count, 0);
  assert.equal(a.commentCount, 1);
  assert.match(a.snippets[0], /^\[댓글\]/);
});

test("언급이 없으면 none", () => {
  const a = analyzeMentions(post("다이어트 일기", filler(5), ["좋은 글이네요"]), TERMS);
  assert.equal(a.level, "none");
  assert.deepEqual(a.snippets, []);
});

test("제품명 바로 뒤의 부정 표현은 표시한다", () => {
  const a = analyzeMentions(post("다이어트 일기", `${filler(4)}\n솔커트는 저한테 별로였어요. 환불했어요.`), TERMS);
  assert.equal(a.negativeCue, true);
});

test("띄어 쓴 제품명·다른 이름도 잡는다", () => {
  const a = analyzeMentions(post("후기", `${filler(4)}\n솔 커트랑 테르피노 둘 다 먹어봤어요.`), TERMS);
  assert.equal(a.count, 2);
  assert.equal(termPattern(["a", " "]), null); // 한 글자 이하는 찾지 않는다
});

test("블로그 HTML에서 제목과 문단을 뽑는다", () => {
  const html = `<meta property="og:title" content="팥순이 후기 &amp; 정리"/>
    <p class="se-text-paragraph se-text-paragraph-align-center"><span>첫 문단</span></p>
    <p class="se-text-paragraph"><span>​</span></p>
    <p class="se-text-paragraph"><span>둘째&nbsp;문단</span><br>줄바꿈</p>`;
  assert.deepEqual(extractBlogContent(html), { title: "팥순이 후기 & 정리", body: "첫 문단\n둘째 문단\n줄바꿈" });
  assert.equal(extractBlogContent("<html><body>본문 형식이 다른 글</body></html>"), null);
  assert.equal(htmlToText("<p>가</p><div>나<br/>다</div>"), "가\n나\n다");
});
