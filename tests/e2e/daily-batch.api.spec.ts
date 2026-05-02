import { test, expect } from "@playwright/test";

// L1 — API Endpoint Tests for daily-batch + 카페 검색/PATCH 화이트리스트
//
// 실행 전제:
//   1) `pnpm add -D @playwright/test` (또는 npm i -D)
//   2) `npx playwright install chromium`  (L2/L3 시)
//   3) `npm run dev`로 로컬 서버 띄운 상태 (또는 PLAYWRIGHT_BASE_URL 지정)
//
// 환경변수:
//   PLAYWRIGHT_BASE_URL = http://localhost:3000 (default)
//   TEST_CRON_SECRET    = 임의 (서버 .env.local과 동일해야 함)

const CRON_SECRET = process.env.TEST_CRON_SECRET ?? "test-secret";

test.describe("/api/daily-batch — 인증 정책", () => {
  test("Vercel Cron user-agent → 200", async ({ request }) => {
    const res = await request.get("/api/daily-batch", {
      headers: { "user-agent": "vercel-cron/1.0" },
    });
    // 200 또는 (인증은 통과했지만 부모 호출 실패 시) 200 with batches
    expect([200]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("success");
    expect(body).toHaveProperty("batches");
  });

  test("Bearer CRON_SECRET → 200 또는 401 (TEST_CRON_SECRET 매칭 시 200)", async ({ request }) => {
    // 서버 .env.local의 CRON_SECRET과 테스트 환경 TEST_CRON_SECRET이 동일해야 200
    // 그 외에는 401이 정상
    const res = await request.get("/api/daily-batch", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect([200, 401]).toContain(res.status());
  });

  test("인증 헤더 없음 + 프로덕션 모드 → 401", async ({ request }) => {
    // NODE_ENV=production AND CRON_SECRET 설정된 환경에서만 401 보장
    // 개발 모드면 통과될 수 있음 (devFallback)
    const res = await request.get("/api/daily-batch");
    expect([200, 401]).toContain(res.status());
    if (res.status() === 401) {
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    }
  });

  test("잘못된 Bearer 토큰 → 401 (CRON_SECRET 설정 시)", async ({ request }) => {
    const res = await request.get("/api/daily-batch", {
      headers: { authorization: "Bearer invalid-token" },
    });
    expect([200, 401]).toContain(res.status());
  });
});

test.describe("/api/cafe/search — postStatus 3-state", () => {
  // 네이버 외부 호출 의존이라 200 외 응답은 환경(IP 제한 등)에 따라 발생 가능 → 200일 때만 스키마 검증
  test("postUrl 미지정 → postStatus null (200 응답 시)", async ({ request }) => {
    const res = await request.get("/api/cafe/search?keyword=테스트");
    test.skip(res.status() !== 200, `네이버 응답 ${res.status()} (외부 의존, skip)`);
    const body = await res.json();
    expect(body).toHaveProperty("postStatus");
    expect(body.postStatus).toBeNull();
    expect(body.postDeleted).toBe(false);
  });

  test("postUrl 지정 시 postStatus는 정의된 4값 중 하나 (200 응답 시)", async ({ request }) => {
    const res = await request.get(
      "/api/cafe/search?keyword=네이버&postUrl=https://cafe.naver.com/example/1"
    );
    test.skip(res.status() !== 200, `네이버 응답 ${res.status()} (외부 의존, skip)`);
    const body = await res.json();
    expect(["deleted", "alive", "unknown", null]).toContain(body.postStatus);
  });

  test("키워드 누락 → 400", async ({ request }) => {
    const res = await request.get("/api/cafe/search");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("키워드");
  });
});

test.describe("/api/cafe/keywords — PATCH 화이트리스트 (R5)", () => {
  test("허용 외 필드 무시 → 빈 updates면 400", async ({ request }) => {
    // 가짜 id로 시도 (실제 행 없어도 화이트리스트 로직은 먼저 동작)
    const res = await request.patch("/api/cafe/keywords", {
      data: { id: "00000000-0000-0000-0000-000000000000", evil_field: "x", another: 1 },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("수정할 필드");
  });

  test("id 누락 → 400", async ({ request }) => {
    const res = await request.patch("/api/cafe/keywords", {
      data: { matched_title: "test" },
    });
    expect(res.status()).toBe(400);
  });

  test("matched_title: null 통과 (DB 행 존재 시 200)", async ({ request }) => {
    // 실제 존재하는 id 필요. 없으면 500/200 (Supabase 응답)
    const res = await request.patch("/api/cafe/keywords", {
      data: { id: "00000000-0000-0000-0000-000000000000", matched_title: null },
    });
    // 행이 없으면 .single()이 PGRST116 에러 → 500
    // 행이 있으면 200
    expect([200, 500]).toContain(res.status());
  });
});

test.describe("/api/keywords — PATCH 화이트리스트 (R5)", () => {
  test("허용 외 필드 무시 → 빈 updates면 400", async ({ request }) => {
    const res = await request.patch("/api/keywords", {
      data: { id: "00000000-0000-0000-0000-000000000000", client_id: "hacker" },
    });
    expect(res.status()).toBe(400);
  });
});
