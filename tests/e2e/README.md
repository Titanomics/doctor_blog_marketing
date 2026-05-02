# E2E Tests (Playwright)

Gap Analysis 2회차에서 도입된 Runtime 검증 레이어.

## 설치 (1회만)

```bash
# 1. Playwright 패키지 추가
npm install -D @playwright/test

# 2. 브라우저 다운로드 (L2/L3 UI 테스트용)
npx playwright install chromium
```

## 실행

```bash
# 로컬 서버 띄우기
npm run dev

# 다른 터미널에서 — L1 API 테스트 (서버 필요)
npx playwright test --project=api

# L2/L3 UI 테스트 (서버 + 브라우저 필요)
E2E_CAFE_CLIENT_NAME="테스트브랜드" npx playwright test --project=chromium

# 전체
npx playwright test
```

## 환경변수

| 변수 | 용도 | 기본값 |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | 테스트 대상 URL | `http://localhost:3000` |
| `TEST_CRON_SECRET` | daily-batch 인증 테스트 | `test-secret` |
| `E2E_CAFE_CLIENT_NAME` | UI 테스트용 카페 클라이언트 이름 | (미설정 시 skip) |

## 테스트 매트릭스

| 파일 | 레벨 | 검증 항목 |
|---|---|---|
| `daily-batch.api.spec.ts` | L1 | daily-batch 인증 4가지 케이스, cafe/search postStatus, PATCH 화이트리스트 |
| `daily-batch.ui.spec.ts` | L2 | 카페 삭제표시 토글 (G2 보존), 키워드 인라인 수정 (recent feature) |

## 신규 테스트 추가 가이드

- `*.api.spec.ts` → `--project=api` (브라우저 없이 fetch만)
- `*.ui.spec.ts` → `--project=chromium` (브라우저 사용)
