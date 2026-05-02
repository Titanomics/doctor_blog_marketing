# 외부 Cron 설정 가이드 (cron-job.org)

## 배경

Vercel **Hobby 플랜의 cron은 "best effort"** 로 동작하며, 매일 정확히 트리거된다는 보장이 없다. 실제로 2026-04-29 ~ 2026-05-02 사이 cron이 4회 연속 누락되어 갱신/메일이 정지됐다. 따라서 **외부 cron(cron-job.org)** 으로 전환한다.

- vercel.json의 crons 배열은 비웠음 (`{ "crons": [] }`)
- 인증은 기존 `CRON_SECRET` Bearer 방식 그대로 사용

## 설정 절차 (1회만)

### 1. Vercel 환경변수에 CRON_SECRET 등록

1. https://vercel.com/titanomics-projects/doctor-blog-marketing/settings/environment-variables 접속
2. **Add Another** 클릭
3. 입력
   - Name: `CRON_SECRET`
   - Value: 아래 명령으로 생성한 32자 랜덤 문자열
   - Environments: Production / Preview / Development 모두 체크
4. 저장 후 재배포 (Deployments → Latest → Redeploy)

랜덤 시크릿 생성 (PowerShell):
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

### 2. cron-job.org 계정 + 2개 잡 등록

1. https://cron-job.org 가입 (무료, 이메일만 필요)
2. **Cronjobs → CREATE CRONJOB** 두 번 반복 (아래 표대로)

#### Job 1 — daily-batch (매일 KST 03:00)

| 항목 | 값 |
|---|---|
| Title | `doctor-blog daily-batch` |
| URL | `https://doctor-blog-marketing.vercel.app/api/daily-batch` |
| Schedule | Every day at **18:00 UTC** (= KST 03:00) |
| Request method | GET |
| **Headers** | `Authorization: Bearer <CRON_SECRET 값>` |
| Notifications | (선택) 실패 시 이메일 |
| Save responses | ON (디버깅 편의) |

#### Job 2 — daily-report (매일 KST 07:00)

| 항목 | 값 |
|---|---|
| Title | `doctor-blog daily-report` |
| URL | `https://doctor-blog-marketing.vercel.app/api/cafe/daily-report` |
| Schedule | Every day at **22:00 UTC** (= KST 07:00) |
| Request method | GET |
| **Headers** | `Authorization: Bearer <CRON_SECRET 값>` |
| Notifications | (선택) 실패 시 이메일 |
| Save responses | ON |

### 3. 검증

각 잡 화면에서 **"Test run"** 클릭 → 응답 200 확인.
- daily-batch 응답: `{"success":true,"batches":[...]}` (3개 fulfilled)
- daily-report 응답: `{"success":true,"date":"...","total":N}`

## 문제 발생 시 디버깅

### 401 Unauthorized
- `CRON_SECRET` 값 일치 확인 (Vercel env vs cron-job 헤더)
- 헤더 형식 확인: `Authorization: Bearer xxx` (공백 1칸, Bearer 대문자 B)
- Vercel 환경변수 추가 후 **재배포 필수**

### 5xx 에러
- Vercel Function 로그 확인
- Supabase 연결 상태 확인 (Free tier 휴면 가능성)

### Cron이 실행됐는데 갱신 안 됨
- cron-job.org "Save responses" 토글 켜고 다음 실행 응답 본문 확인
- 부모 batch-track의 fan-out 결과 확인

## 비교 대안

| 옵션 | 비용 | 신뢰성 | 비고 |
|---|---|---|---|
| **cron-job.org** (현재) | $0 | 99.9% | 매분 단위, 무료 |
| EasyCron | $0~ | 99.9% | 무료는 5분 간격 |
| GitHub Actions cron | $0 | 99% | private repo도 무료 (2,000분/월) |
| Vercel Pro | $20/월 | 100% | Hobby의 모든 제약 해제 |

## 복구 (비상시)

cron-job.org 장애 시 vercel.json crons 배열 복원으로 즉시 fallback:
```json
{
  "crons": [
    { "path": "/api/daily-batch", "schedule": "0 18 * * *" },
    { "path": "/api/cafe/daily-report", "schedule": "0 22 * * *" }
  ]
}
```
+ git commit + push → 자동 재배포.
