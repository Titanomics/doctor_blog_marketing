---
name: vercel-batch-orchestration
description: |
  Vercel Hobby에서 안정적인 일일 배치 처리 패턴 가이드.
  외부 API(예: 네이버 검색)을 N개 호출하는 일일 cron 작업의
  설계, 실패 회복, fan-out 신뢰성, chunk 분할, 인증을 다룸.

  Use when: Vercel cron 누락 / fan-out 신뢰성 / 큰 client maxDuration 초과 /
            GitHub Actions cron 도입 / 외부 trigger 전환을 결정해야 할 때.
  Do NOT use for: Vercel Pro 환경 (maxDuration 한도 충분), 1회성 처리.
---

# Vercel Batch Orchestration Pattern

> 2026-05-02 ~ 2026-05-03에 doctor-blog-marketing(블로그 키워드 순위 추적) 프로젝트에서
> 검증된 패턴. Vercel Hobby + 외부 API 호출 + 일일 cron 케이스에 직접 적용 가능.

## 의사결정 트리

```
Q1. 매일 cron이 정확히 트리거돼야 하는가?
  YES → Vercel Hobby cron은 "best-effort"라 누락 가능
        → GitHub Actions cron 권장 (private repo도 무료 2,000분/월)
  NO  → vercel.json crons 사용 가능

Q2. 한 client/한 작업이 60s 안에 끝나는가?
  YES → 단일 함수 동기 처리. 체인/fan-out 불필요
  NO  → chunk 분할 필요

Q3. chunk 처리에서 자식 함수가 다음 chunk를 trigger하는가?
  내부 체인 (after() + self-fetch) → 신뢰성 100% 아님 (체인 끊김 가능)
  외부 trigger (GitHub Actions matrix/loop) → 신뢰성 100%, 체인 의존 0
  → 큰 처리량은 외부 trigger 권장
```

## 핵심 안티-패턴 3가지

### A1. Vercel Hobby cron 의존
**증상**: 4월 29일 ~ 5월 2일 cron 4회 연속 누락. 화면 갱신/메일 정지.
**원인**: Hobby plan의 cron은 "1-hour flexible window" + best-effort.
**해결**: vercel.json crons 비우고 GitHub Actions로 전환.

### A2. 부모 after()가 자식을 await
**증상**: 부모 maxDuration 5분인데 9 그룹 직렬 await = 30분 → 부모 함수 죽음 → 첫 80개만 처리되고 92% 누락.
**원인**: chunk 처리 시간이 부모 lifetime을 초과하는 곱셈 효과.
**해결**: 부모는 fire-and-forget으로 첫 chunk만 trigger 후 즉시 응답.

### A3. 체인 패턴 (chunk가 다음 chunk trigger)
**증상**: chunk 5에서 fetch fail → chunk 6+ 영영 누락. silent.
**원인**: Vercel after() 안 outgoing fetch 신뢰성 100% 아님.
**해결**: 외부 cron(GitHub Actions)이 모든 chunk를 직렬 직접 호출. 체인 의존 0.

## 권장 아키텍처

```
GitHub Actions cron (KST 03:00)
└── Workflow: 모든 client × chunks 직렬 curl
    ├── domain=blog: 클라이언트 N개 × chunks
    ├── domain=cafe: 클라이언트 M개 × chunks
    └── domain=reporter: 클라이언트 K개 × chunks
        └── 각 호출:
            curl -H "Authorization: Bearer $CRON_SECRET" \
                "$URL/api/.../batch-track?clientId=X&offset=Y&limit=20&total=Z"

Vercel API: per-client / per-chunk endpoint
└── chunk 모드: offset+limit+total 받고 N개 키워드 동기 처리
    - CHUNK_SIZE = 20 (자식 maxDuration 200s 안)
    - KEYWORD_DELAY_MS = 10000 (네이버 차단 회피)
    - FETCH_TIMEOUT_MS = 8000 (개별 키워드 hang 방지)
└── per-client 모드: SYNC_THRESHOLD 이하면 동기, 초과면 chunk 안내만
└── 인증: Bearer CRON_SECRET 단일 (UA fallback 제거)
```

## 인증 셋업 자동화

Vercel + GitHub 양쪽에 CRON_SECRET 등록:

```bash
# 1. 시크릿 생성 (PowerShell, 40자)
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})

# 2. Vercel API로 환경변수 등록 (CLI link 우회)
TOKEN=$(cat ~/AppData/Roaming/com.vercel.cli/Data/auth.json | jq -r .token)
TEAM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v2/teams" | jq -r '.teams[]|select(.slug=="team-slug")|.id')
PROJECT_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects?teamId=$TEAM_ID" | jq -r '.projects[]|select(.name=="project-name")|.id')

curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"CRON_SECRET\",\"value\":\"$SECRET\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}"

# 3. GitHub Actions secret
gh secret set CRON_SECRET --body "$SECRET" --repo OWNER/REPO

# 4. Vercel redeploy (env 반영)
LATEST=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?teamId=$TEAM_ID&projectId=$PROJECT_ID&target=production&limit=1" | jq -r '.deployments[0].uid')
curl -X POST "https://api.vercel.com/v13/deployments?teamId=$TEAM_ID&forceNew=1" \
  -H "Authorization: Bearer $TOKEN" -d "{\"name\":\"PROJECT\",\"deploymentId\":\"$LATEST\",\"target\":\"production\"}"
```

## GitHub Actions Workflow 템플릿

```yaml
name: Daily Batch (KST 03:00)

on:
  schedule:
    - cron: "0 18 * * *"   # UTC 18:00 = KST 03:00
  workflow_dispatch:
    inputs:
      domain:
        description: "all/blog/cafe/reporter"
        default: "all"

env:
  BASE_URL: https://YOUR.vercel.app
  CHUNK_INTERVAL_S: 230  # chunk 사이 sleep (자식 200s + 30s 여유)
  CHUNK_SIZE: 20

jobs:
  blog-batch:
    if: ${{ inputs.domain == '' || inputs.domain == 'all' || inputs.domain == 'blog' }}
    runs-on: ubuntu-latest
    timeout-minutes: 350  # 6시간 한도 내
    steps:
      - env: { CRON_SECRET: ${{ secrets.CRON_SECRET }} }
        run: |
          set -euo pipefail
          AUTH="Authorization: Bearer $CRON_SECRET"
          CLIENTS=$(curl -fsSL -H "$AUTH" "$BASE_URL/api/clients" | python3 -c "import json,sys;[print(c['id']) for c in json.load(sys.stdin)]")
          for ID in $CLIENTS; do
            COUNT=$(curl -fsSL -H "$AUTH" "$BASE_URL/api/keywords?clientId=$ID" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
            [ "$COUNT" -le 0 ] && continue
            if [ "$COUNT" -le 10 ]; then
              curl -fsSL -m 300 -H "$AUTH" -X POST "$BASE_URL/api/batch-track?clientId=$ID" || echo "::warning::sync $ID failed"
              continue
            fi
            OFF=0
            while [ "$OFF" -lt "$COUNT" ]; do
              curl -fsSL -m 280 -H "$AUTH" -X POST \
                "$BASE_URL/api/batch-track?clientId=$ID&offset=$OFF&limit=$CHUNK_SIZE&total=$COUNT" \
                || echo "::warning::chunk $ID off=$OFF failed"
              OFF=$((OFF + CHUNK_SIZE))
              [ "$OFF" -lt "$COUNT" ] && sleep $CHUNK_INTERVAL_S
            done
          done
  # cafe, reporter도 동일 패턴
```

## Vercel API 핸들러 템플릿

```ts
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const KEYWORD_DELAY_MS = 10000;
const CHUNK_SIZE = 20;
const SYNC_THRESHOLD = 10;
const FETCH_TIMEOUT_MS = 8000;

async function processKeyword(client, kw) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(externalUrl, { signal: ctrl.signal, cache: "no-store" });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    // ... DB update ...
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function handler(request) {
  // 1) 인증 (Bearer 단일)
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const offsetParam = sp.get("offset");
  const limitParam = sp.get("limit");

  // 2) chunk 모드: 외부 cron이 직접 호출
  if (clientId && offsetParam !== null && limitParam !== null) {
    const offset = parseInt(offsetParam, 10);
    const limit = parseInt(limitParam, 10);
    if (!Number.isFinite(offset) || !Number.isFinite(limit) ||
        offset < 0 || limit <= 0 || limit > CHUNK_SIZE) {
      return NextResponse.json({ error: "invalid offset/limit" }, { status: 400 });
    }
    // ... range(offset, offset+limit-1) SELECT ...
    // ... 키워드 직렬 처리, 사이 KEYWORD_DELAY_MS sleep ...
    // 체인 의존 X — 다음 chunk trigger 안 함 (외부 cron이 책임)
    return NextResponse.json({ updated, errors });
  }

  // 3) per-client 모드: 작은 client는 동기, 큰 client는 chunk 안내만
  if (clientId) {
    const count = await getCount(clientId);
    if (count <= SYNC_THRESHOLD) {
      // 동기 처리 (60s 안 안전)
      return NextResponse.json({ updated, errors });
    }
    // 큰 client는 외부 cron 책임이므로 클라이언트에 chunk 정보만 반환
    return NextResponse.json({
      message: `${count} 키워드 ${Math.ceil(count/CHUNK_SIZE)} chunk — 외부 cron이 처리`,
      total: count,
      chunks: Math.ceil(count / CHUNK_SIZE),
    });
  }
}
```

## 처리 시간 가이드

| 키워드 수 | chunk 수 | 처리 시간 | GitHub Actions runtime |
|---|---|---|---|
| 100 | 5 | ~20분 | ~20분 |
| 200 | 10 | ~40분 | ~40분 |
| 500 | 25 | ~96분 | ~96분 |
| 1000 | 50 | ~3시간 12분 | ~192분 |
| 1500 | 75 | ~4시간 48분 | 한도 위험 (월 2000분) |

**한도 임계**: 월 2000분 / 30일 = 일 67분. 매일 67분 초과 시 무료 한도 부족.
1000+ 키워드라면 격일제 또는 Vercel Pro($20/월) 검토.

## 실측 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 매일 갱신 안 됨 | Hobby cron best-effort 누락 | GitHub Actions cron으로 전환 |
| 부분 갱신만 됨 | fan-out fire-and-forget이 자식 안 깨움 | after() + 외부 trigger로 |
| 첫 N개만 갱신 | 체인 도중 끊김 | 외부 cron이 직접 모든 chunk 호출 |
| 자식 timeout 504 | maxDuration 초과 (CHUNK_SIZE 큼) | CHUNK_SIZE = 20, KEYWORD_DELAY_MS = 10s |
| 401 인증 실패 | UA 위조 시도 | UA fallback 제거, Bearer 단일화 |
| 차단 5%+ | concurrency 너무 빠름 | 키워드당 10초 stagger |

## 관련 reference

- 본 프로젝트 구현: `app/api/{batch-track,cafe/batch-track,reporter/batch-track}/route.ts`
- GitHub Actions: `.github/workflows/daily-batch.yml`
- 분석 보고서: `docs/03-analysis/code-review-2026-05-02.md`
- 디자인 spec: `docs/superpowers/specs/2026-05-02-keyword-stagger-10s-design.md`
