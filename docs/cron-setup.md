# Cron 설정 가이드 (GitHub Actions)

## 배경

Vercel **Hobby 플랜의 cron은 "best effort"** 로 동작하며, 매일 정확히 트리거된다는 보장이 없다. 2026-04-29 ~ 2026-05-02 사이 cron이 4회 연속 누락되어 갱신/메일이 정지됐다. 따라서 **GitHub Actions cron** 으로 전환했다.

선택 이유:
- 무료 (private repo도 매월 2,000분 제공, 1회 호출 = ~1분)
- 외부 계정 가입 불필요 (이미 GitHub 사용 중)
- 코드와 함께 버전 관리 (워크플로우 파일이 레포에 포함)
- 인증은 기존 `CRON_SECRET` Bearer 방식 그대로 사용

## 구성

| 파일 | 시각 | 호출 |
|---|---|---|
| `.github/workflows/daily-batch.yml` | UTC 18:00 / KST 03:00 | GET `/api/daily-batch` |
| `.github/workflows/daily-report.yml` | UTC 22:00 / KST 07:00 | GET `/api/cafe/daily-report` |

각 워크플로우는:
- `schedule` cron으로 자동 실행
- `workflow_dispatch`로 수동 실행 가능 (Actions 탭에서 "Run workflow" 버튼)
- 실패 시 GitHub Actions 알림 (이메일/UI)

## 시크릿 (이미 등록됨)

| 위치 | 키 | 용도 |
|---|---|---|
| Vercel Production env | `CRON_SECRET` | 라우트 인증 |
| Vercel Preview env | `CRON_SECRET` | 라우트 인증 |
| Vercel Development env | `CRON_SECRET` | 라우트 인증 |
| GitHub repo Actions secret | `CRON_SECRET` | 워크플로우에서 Bearer 헤더로 전달 |

값은 동일 (40자 랜덤). 변경 시 4곳 모두 동기화 필요.

## 수동 트리거 / 검증

### GitHub UI
1. https://github.com/Titanomics/doctor_blog_marketing/actions 접속
2. 좌측에서 "Daily Batch" 또는 "Daily Report" 선택
3. 우측 **Run workflow** 버튼 → main 브랜치 → Run workflow

### CLI
```bash
gh workflow run daily-batch.yml --repo Titanomics/doctor_blog_marketing
gh workflow run daily-report.yml --repo Titanomics/doctor_blog_marketing
gh run list --repo Titanomics/doctor_blog_marketing --limit 5
```

## 로그 확인

```bash
gh run list --repo Titanomics/doctor_blog_marketing --workflow daily-batch.yml --limit 5
gh run view <run-id> --log
```

또는 Actions 탭에서 Run 클릭 → 단계별 로그.

## 문제 해결

### 401 Unauthorized
- Vercel env `CRON_SECRET`과 GitHub Actions secret 값 일치 확인
- Vercel은 env 변경 후 **재배포 필요** (자동으로는 반영 안 됨)
- GitHub Actions secret은 즉시 반영

### 5xx 또는 timeout
- Vercel Function 로그 확인 (Deployments → Latest → Functions)
- Supabase 연결 상태 (free tier 휴면 가능)
- per-client chunk fan-out 도입 후 부모는 즉시 응답하므로 timeout 거의 없음

### Cron이 안 돌았다면
- GitHub Actions는 트래픽 폭주 시 5-10분 지연 가능 (정상)
- 30분 이상 지연되면 https://www.githubstatus.com 확인
- workflow가 제대로 등록됐는지: `gh workflow list`

### 시간대 변경
모든 schedule은 UTC. KST → UTC 변환:
- KST 03:00 → UTC 18:00 (전날)
- KST 07:00 → UTC 22:00 (전날)

## 비교 대안 (참고)

| 옵션 | 비용 | 신뢰성 | 비고 |
|---|---|---|---|
| **GitHub Actions** (현재) | $0 | 99% | 코드와 함께, 외부 계정 불필요 |
| cron-job.org | $0 | 99.9% | 별도 가입, 매분 단위 |
| Vercel Pro | $20/월 | 100% | 전체 Hobby 제약 해제 |

## 복구 (비상시)

GitHub Actions 장애가 길어지면 Vercel cron으로 임시 fallback:

```json
// vercel.json
{
  "crons": [
    { "path": "/api/daily-batch", "schedule": "0 18 * * *" },
    { "path": "/api/cafe/daily-report", "schedule": "0 22 * * *" }
  ]
}
```

+ git push → 자동 재배포. 단 Hobby best-effort라 누락 가능.
