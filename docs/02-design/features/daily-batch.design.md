# daily-batch — Design (회고 작성)

- **Feature**: daily-batch
- **Phase**: Design (역공학 회고)
- **Date**: 2026-05-02

## Context Anchor

| 항목 | 값 |
|---|---|
| **WHY** | 자동 키워드 순위 추적 + 데이터 신선도 + Vercel Hobby 60s 제한 회피 |
| **WHO** | 운영자(김경록) / 모니터링(진선/지수) |
| **RISK** | 60s 타임아웃 / 네이버 차단 / DoS / 데이터 일관성 |
| **SUCCESS** | 일일 갱신 99%+ / 매칭 정확도 90%+ / 외부 호출 차단 100% |
| **SCOPE** | daily-batch + 3개 부모 + 카페 삭제 감지 + 대시보드 + 메일 |

## 1. Architecture (선택안: Pragmatic Balance)

```
[Vercel Cron]
   │
   │ KST 03시 (UTC 18시) — vercel.json:/api/daily-batch
   ▼
┌──────────────────────────────────┐
│  /api/daily-batch (60s)          │
│  - 인증: vercel-cron UA / Bearer │
│  - Promise.allSettled로 3개 부모 │
└──┬─────────┬──────────┬──────────┘
   │         │          │
   ▼         ▼          ▼
┌──────┐ ┌──────┐ ┌────────┐
│blog  │ │cafe  │ │reporter│  부모 (300s, 클라이언트별 fan-out)
└──┬───┘ └──┬───┘ └──┬─────┘
   │ fire-and-forget per-client
   ▼         ▼          ▼
[per-client subroutes (60s)]
   │ 키워드 순회 + 네이버 fetch + DB upsert + history
   ▼
[Supabase]
   │
   ▼
[대시보드 UI: cache: no-store / force-dynamic]
   │
   └──> [메일 cron — KST 07시: /api/cafe/daily-report]
```

## 2. Cron 스케줄 (확정)

| Path | Cron (UTC) | KST | 비고 |
|---|---|---|---|
| `/api/daily-batch` | `0 18 * * *` | 03시 | 매일 1회 (배치만) |
| `/api/cafe/daily-report` | `0 22 * * *` | 07시 | 매일 1회 (메일만) |

**의도된 분리**: 배치 완료 후 메일 발송. 과거 1회 메일/배치 통합 → 분리 → 하루 2회 시도 → 최종 1회/일 (commit `131c083 크론 역할 분리: 배치(새벽3시) / 메일(오전7시)`로 확정). **현재 형태는 의도된 최종 상태**.

> R1 결과: vercel.json 1회/일 스케줄이 의도대로이며 추가 변경 불필요. JSON에 코멘트가 안 들어가므로 본 Design 문서로 의도 명시.

## 3. 인증 정책 (R4 강화 후)

| 케이스 | 동작 |
|---|---|
| `User-Agent: vercel-cron/...` | ✅ 통과 |
| `Authorization: Bearer ${CRON_SECRET}` | ✅ 통과 |
| `NODE_ENV=development` AND `CRON_SECRET` 미설정 | ✅ 통과 (개발 편의) |
| 그 외 (production + CRON_SECRET 미설정 포함) | ❌ 401 + `console.error` 로깅 |

## 4. API Contract

### `/api/daily-batch` (GET)
```
Request:  Headers: User-Agent | Authorization
Response: { success: true, message: string, batches: [{ url, status, result }] }
          또는 { error: "Unauthorized" } 401
```

### `/api/cafe/search` (GET)
```
Request:  ?keyword=...&postUrl=...&postTitle=...
Response: {
  results, found, foundRank,
  smartBlockResults, foundInSmartBlock,
  replyResults, foundInReply,
  postDeleted: boolean,            // 하위 호환
  postStatus: 'deleted'|'alive'|'unknown'|null  // R2 신규
}
```

### `/api/cafe/keywords` (PATCH) — R5 화이트리스트
허용 필드: `keyword, post_url, post_title, author_name, current_rank, previous_rank, matched_title, matched_url, smart_block_name, smart_block_rank, is_reply, reply_since, updated_at`
거부: `id, client_id, created_at, 그 외` → 무시 (빈 updates면 400)

### `/api/keywords` (PATCH)
허용 필드: `keyword, priority, current_rank, previous_rank, matched_title, matched_url, smart_block_name, smart_block_rank, updated_at`

### `/api/reporter/entries` (PATCH)
허용 필드: `blog_url, current_rank, previous_rank, matched_title, matched_url, smart_block_name, smart_block_rank, updated_at`

## 5. 카페 삭제 감지 정책 (R2 3-state)

```
입력: cafe.naver.com/{shortcut}/{articleId}
↓
GET https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/{shortcut}/articles/{articleId}
↓
res.status === 200            → 'alive'   (정상 글)
res.status === 404 + 4003     → 'deleted' (명시적 삭제)
res.status === 404 + JSON err → 'deleted' (404 강한 신호)
res.status === 404 + 기타     → 'unknown'
res.status === 5xx 등         → 'unknown'
fetch 예외                    → 'unknown'
URL 파싱 실패                 → 'unknown'
```

호출부 정책:
- `'deleted'` → `matched_title = "[삭제된 게시글]"`
- `'alive'` → 정상 매칭 결과로 갱신 (덮어쓰기 허용)
- `'unknown'` + 매칭 실패 + 기존이 `[삭제된 게시글]` → **보존** (수동 토글 또는 일시 API 장애 흡수)

## 6. URL 정규화

모든 카페 URL은 매칭 전에 정규화:
```
https?://m.cafe.naver.com/...  →  https://cafe.naver.com/...
```
- `cafe/search` (R3 수정으로 일관)
- `cafe/batch-track` (이미 적용 + R3 후속)
- `checkCafePostDeleted` 정규식은 양쪽 모두 매치

## 7. 꼬리글 상태 (G1 수정 후)

```
isReply = !!foundInReply && !found && !foundInSmartBlock

if (isReply && !kw.is_reply)  → reply_since = now()      [꼬리글 진입]
else if (!isReply)            → reply_since = null       [꼬리글 아님 / 빠져나옴]
else                          → reply_since 보존         [꼬리글 유지]
```

## 8. 데이터 모델

| Table | Key Fields |
|---|---|
| `clients` | id, name, blog_url |
| `cafe_clients` | id, name |
| `keywords` | id, client_id, keyword, current_rank, matched_title, matched_url, ... |
| `cafe_keywords` | id, client_id, keyword, post_url, post_title, current_rank, matched_title, is_reply, reply_since, ... |
| `reporter_keywords` | id, client_id, keyword |
| `reporter_blog_entries` | id, keyword_id, blog_url, current_rank, ... |
| `keyword_history` / `cafe_keyword_history` / `reporter_history` | rank, tracked_date (PK: keyword_id+tracked_date) |

## 9. 에러 처리

- `daily-batch`: `Promise.allSettled` → 부모 실패도 다른 부모 진행. summary로 반환
- 부모 batch-track: 클라이언트별 fan-out에 `.catch(() => {})` (자식 실패가 부모를 죽이지 않음)
- 자식 batch-track: 키워드 순회 try/catch로 errors 누적 후 응답
- 인증 실패: 401 + `console.error` (R4)

## 10. 캐싱 차단 (이전 C8/C9)

- API 라우트: `export const dynamic = "force-dynamic"; export const revalidate = 0;`
- API 응답: `Cache-Control: no-store, max-age=0`
- 클라이언트 fetch: `cache: 'no-store'`
- 검색 fetch: `cache: 'no-store'`

## 11. Implementation Guide

### 11.1 모듈 맵

```
app/api/daily-batch/route.ts             — 진입점 cron
app/api/batch-track/route.ts             — 블로그 부모
app/api/cafe/batch-track/route.ts        — 카페 부모
app/api/reporter/batch-track/route.ts    — 기자단 부모
app/api/cafe/search/route.ts             — 수동 검색/refresh
app/api/cafe/keywords/route.ts           — CRUD + 화이트리스트
app/api/keywords/route.ts                — CRUD + 화이트리스트
app/api/reporter/entries/route.ts        — CRUD + 화이트리스트
lib/checkCafePostDeleted.ts              — 3-state 상태 판정
lib/parseNaver.ts                        — VIEW/스마트블록/꼬리글 파싱
components/dashboard/MainPanel.tsx       — UI + 수동 갱신/삭제표시
```

### 11.2 변경 이력 (Gap Analysis)

- **2026-04-22 (1회차)**: Critical 7건 + Important 1건 (C1/C3/C4/C6/C8/C9 + I5)
- **2026-05-02 (2회차)**: Critical 2건 + Important 1건 (G1/G2/G3) + R2/R4/R5 후속

## 12. Test Plan (R3와 연계)

### L1 — API Endpoint
- `GET /api/daily-batch` UA=vercel-cron → 200
- `GET /api/daily-batch` UA=test, NODE_ENV=production, CRON_SECRET 미설정 → 401
- `PATCH /api/cafe/keywords` body=`{ id, evil_field: "x" }` → 400 (빈 updates)
- `PATCH /api/cafe/keywords` body=`{ id, matched_title: null }` → 200
- `GET /api/cafe/search?keyword=&postUrl=invalid` → `postStatus: null`

### L2 — UI Action
- "삭제표시" 토글 → matched_title="[삭제된 게시글]" → 새로고침 후 자동 매칭이 덮어쓰지 않음 확인

### L3 — E2E
- daily-batch 실행 → 3개 부모 응답 → DB 갱신 확인 → 메일 cron이 갱신된 데이터를 사용
