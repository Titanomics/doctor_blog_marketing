# E2E Tests (Playwright)

Gap Analysis 2회차에서 도입된 Runtime 검증 레이어.

## 설치 (1회만)

```bash
npm install -D @playwright/test
npx playwright install chromium    # L2/L3 UI 테스트 시
```

## 실행 — 안전 모드 (기본값)

운영 데이터 영향 없는 테스트만 실행:
- 인증 실패(401)
- 키워드 누락(400)
- PATCH 화이트리스트(400)
- PATCH 가짜 id (행 미존재)

### 옵션 A. Vercel 배포본 대상 (권장 — dev 서버 불필요)

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://your-app.vercel.app"
npx playwright test --project=api
```

### 옵션 B. 로컬 dev 서버 대상

```bash
npm run dev   # 포트 3000 (또는 다른 앱이 점유 중이면 3001)
# 다른 터미널에서
npx playwright test --project=api
```

## 실행 — 파괴적 모드 (격리 환경 전용)

`daily-batch GET → 200` 케이스는 **실제 네이버 크롤링 + DB 갱신을 트리거**합니다.
운영 영향이 있으므로 다음 조건에서만 활성화:
- 로컬 dev + dev/staging supabase
- Vercel preview branch
- 별도 격리 프로젝트

```powershell
$env:E2E_ALLOW_DESTRUCTIVE = "1"
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3001"   # 격리된 환경
npx playwright test --project=api
```

`E2E_ALLOW_DESTRUCTIVE`가 미설정이면 해당 테스트는 자동 skip됩니다.

## 환경변수

| 변수 | 용도 | 기본값 |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | 테스트 대상 URL | `http://localhost:3000` |
| `TEST_CRON_SECRET` | daily-batch 인증 테스트 토큰 | `test-secret` |
| `E2E_ALLOW_DESTRUCTIVE` | `1`이면 파괴적 테스트 활성화 | (미설정 = skip) |
| `E2E_CAFE_CLIENT_NAME` | UI 테스트용 카페 클라이언트 이름 | (미설정 시 skip) |

## 테스트 매트릭스

| 파일 | 레벨 | 검증 항목 | 안전성 |
|---|---|---|---|
| `daily-batch.api.spec.ts` | L1 | daily-batch 인증 401 / cafe/search 400 / PATCH 화이트리스트 | ✅ 운영 영향 없음 |
| `daily-batch.api.spec.ts` | L1 | daily-batch GET 200 (배치 트리거) | ⚠️ DESTRUCTIVE — 가드 적용됨 |
| `daily-batch.ui.spec.ts` | L2 | 카페 삭제표시 토글, 인라인 수정 | ⚠️ 실제 클라이언트 데이터 사용 |
