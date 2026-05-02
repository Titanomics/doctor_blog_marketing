# Keyword 10s Stagger Design

- **Date**: 2026-05-02
- **Topic**: 큰 client 갱신을 키워드당 10초 간격으로 보수적 처리
- **Approved by**: 사용자 (B안 선택)

## 배경

직전 패치 (`e4c4fe7`)로 N1-new/N2-new/m1/N1/m4 처리. CHUNK_PARALLEL=3 + GROUP_DELAY=200ms로 5% 차단률을 유지. 사용자는 시차 4시간(KST 03:00 batch → 07:00 mail)을 활용해 차단을 거의 0%로 떨어뜨리길 원함.

## Decision

**B안 채택** — chunk 3개 동시 + chunk 안 키워드는 1개씩 10초 간격.

## 변경

### 상수 (3개 batch-track 동일)
| 변수 | 이전 | 신규 | 비고 |
|---|---|---|---|
| `KEYWORD_DELAY_MS` | (없음) | **10000** | 처리 후 sleep |
| `CHUNK_SIZE` | 40 | **20** | 자식 maxDuration 200s 안 |
| `CONCURRENCY` | 3 | **1** | chunk 안 직렬 |
| `CHUNK_PARALLEL` | 3 | 3 | 그대로 (창구 3개) |
| `GROUP_DELAY_MS` | 200 | (제거) | CONCURRENCY=1로 의미 없음 |

### processClient 루프
```ts
// 이전: 그룹 병렬 + 그룹 사이 200ms
for (let i = 0; i < keywords.length; i += CONCURRENCY) {
  const chunk = keywords.slice(i, i + CONCURRENCY);
  const results = await Promise.all(chunk.map((kw) => processKeyword(client, kw)));
  ...
  if (i + CONCURRENCY < keywords.length) await sleep(GROUP_DELAY_MS);
}

// 신규: 키워드 1개씩 + 키워드 사이 10초
for (let i = 0; i < keywords.length; i++) {
  const r = await processKeyword(client, keywords[i]);
  if (r.ok) updated++;
  else if (r.error) errors.push(r.error);
  if (i < keywords.length - 1) await sleep(KEYWORD_DELAY_MS);
}
```

## 처리 시간 (500 키워드)

```
chunk 자식: 20 키워드 × 10초 = 200초 (Vercel maxDuration 300s 안)
chunk 25개 / CHUNK_PARALLEL=3 = 9 그룹
총: 9 × 200초 = 1800초 ≈ 30분
```

## 네이버 부하

```
chunk 3개 동시 × 0.1 req/s = 0.3 req/s
```
사람 검색과 거의 동일. 차단 거의 0%.

## 영향 범위

- **변경 파일** (3): `app/api/batch-track/route.ts`, `app/api/cafe/batch-track/route.ts`, `app/api/reporter/batch-track/route.ts`
- **시그니처 변경 없음**: API 응답/요청 그대로
- **프론트엔드 영향 없음**: MainPanel은 서버 위임 후 90초 대기 → 30분으로 늘어나도 timeout 후 자동 새로고침은 사용자가 수동 새로고침으로 보완 (작은 client는 직렬 패턴 그대로)

## Risk Register

| ID | 위험 | 완화 |
|---|---|---|
| RK-1 | 자식 maxDuration 한도 200s에 가까워 네이버 응답 지연 시 timeout | CHUNK_SIZE=20으로 100s 여유 |
| RK-2 | UI batch refresh가 30분 걸리는데 90초 후 자동 새로고침은 부분 결과만 보여줌 | 작은 client는 직렬 (변경 없음). 큰 client는 사용자가 수동 새로고침 |
| RK-3 | 30분 동안 다른 cron 트리거되면 중복 | 시차 4시간이라 거의 불가 + cron-job.org 단일 |

## Success Criteria

- daily-batch 정상 트리거 (Bearer 인증)
- 1000 키워드 client도 자식 timeout 없이 완료
- 차단률 < 1% (이전 5% 대비)
- 처리 시간 ≤ 35분 (시차 4시간 안)

## Test Plan

- 빌드: `tsc --noEmit` + `next build`
- 수동 트리거: GitHub Actions workflow_dispatch → 응답 200 + 처리 로그 확인
- 차단률 측정: 다음 자동 cron 후 errors 배열 카운트
