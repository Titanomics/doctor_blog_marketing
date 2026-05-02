import { test, expect } from "@playwright/test";

// L2 — UI Action Tests
// 전제: 로컬 서버 + 카페 클라이언트 1개 + 키워드 1개 이상 등록되어 있어야 함
// 환경변수:
//   E2E_CAFE_CLIENT_NAME = 테스트 브랜드 이름

const CAFE_CLIENT = process.env.E2E_CAFE_CLIENT_NAME;

test.describe("대시보드 — 카페 모드 삭제표시 토글 (G2)", () => {
  test.skip(!CAFE_CLIENT, "E2E_CAFE_CLIENT_NAME 미설정");

  test("삭제표시 → 토글 → 표시 보존", async ({ page }) => {
    await page.goto("/cafe");

    // 카페 클라이언트 선택
    await page.getByRole("button", { name: CAFE_CLIENT! }).click();

    // 첫 키워드의 "삭제표시" 버튼 찾기
    const firstRow = page.locator("table tbody tr").first();
    const toggleBtn = firstRow.getByRole("button", { name: /삭제표시|삭제됨/ });

    const initialState = await toggleBtn.innerText();
    await toggleBtn.click();

    // 상태 전환 확인
    await expect(toggleBtn).not.toHaveText(initialState);

    // 다시 토글 (원복)
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(initialState);
  });
});

test.describe("대시보드 — 키워드 인라인 수정 (recent feature)", () => {
  test.skip(!CAFE_CLIENT, "E2E_CAFE_CLIENT_NAME 미설정");

  test("연필 아이콘 → 입력 → 저장", async ({ page }) => {
    await page.goto("/cafe");
    await page.getByRole("button", { name: CAFE_CLIENT! }).click();

    const firstRow = page.locator("table tbody tr").first();
    await firstRow.locator("button[title='키워드 수정']").click();

    // 입력 필드가 나타나야 함
    await expect(firstRow.locator("input[placeholder='키워드']")).toBeVisible();

    // ESC로 취소
    await firstRow.locator("input[placeholder='키워드']").press("Escape");
    await expect(firstRow.locator("input[placeholder='키워드']")).not.toBeVisible();
  });
});
