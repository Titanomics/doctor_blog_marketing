# Cafe Stats Tab Design

- **Date**: 2026-05-17
- **Topic**: 카페 모드에 월별 발행 통계 탭 추가
- **Approved**: 사용자 (OK)

## 요구사항

1. 카페 모드에 별도 "📊 통계" 탭
2. 월별 (최근 3개월 슬라이딩) + 월 안에 카페별 합산
3. 카페 식별: 키워드 추가 시 사용자 입력 (자유 텍스트)
4. 발행일 기준: 키워드 등록일 (`created_at`)
5. 기존 248개 키워드는 post_url에서 shortcut 자동 fallback

## 데이터 모델

`cafe_keywords` 테이블에 컬럼 추가:
```sql
ALTER TABLE cafe_keywords ADD COLUMN IF NOT EXISTS cafe_name TEXT NULL;
COMMENT ON COLUMN cafe_keywords.cafe_name IS '카페 이름(자유 텍스트). 미입력 시 post_url shortcut으로 자동 분류';
```
- nullable, 인덱스 불필요 (월 X cafe_name 카디널리티 낮음)

## API

### 변경: `app/api/cafe/keywords/route.ts`
- POST body 받는 필드 + ALLOWED_PATCH_FIELDS에 `cafe_name` 추가

### 신규: `app/api/cafe/stats/route.ts`
```
GET /api/cafe/stats?clientId={X}

응답:
{
  "months": [
    {
      "month": "2026-03",
      "label": "3월",
      "total": 10,
      "cafes": [
        { "name": "부산맘카페", "count": 8, "source": "user" },
        { "name": "cantsb", "count": 2, "source": "auto-shortcut" }
      ]
    },
    ...
  ]
}
```

규칙:
- 최근 3개월 (오늘 KST 기준 month - 0, -1, -2)
- `cafe_name`이 있으면 그대로 (`source: "user"`)
- 없으면 `post_url`에서 shortcut 추출 (`source: "auto-shortcut"`)
- shortcut도 추출 못 하면 `"미분류"`
- 카페 내림차순 정렬 (count desc)

## UI

### 키워드 추가 폼 (카페 모드)
필드 1개 추가:
- placeholder: "카페 이름 (선택, 예: 부산맘카페)"
- 위치: 작성자 필드 아래

### 카페 모드 상단 탭
헤더에 토글:
- `[ 키워드 ]` (기본) / `[ 📊 통계 ]`
- 라우트 변경 없음. 같은 컴포넌트 안에서 view state 토글

### 통계 화면
```
[ 3월 ]  [ 4월 ]  [ 5월 ]   ← 탭 (현재 월 기준 -2, -1, 0)

5월 발행: 총 17건
──────────────────
부산맘카페       ████████  12건
cantsb (자동)   ███       3건
미분류           █         2건
```
- 막대 너비 = count / max(count) * 100%
- `source: "auto-shortcut"`인 카페는 이름 뒤에 `(자동)` 작은 회색 텍스트

## 영향 파일

| 파일 | 변경 |
|---|---|
| `supabase/migrations/{ts}_add_cafe_name.sql` | 신규 |
| `app/api/cafe/keywords/route.ts` | POST + PATCH 화이트리스트 |
| `app/api/cafe/stats/route.ts` | 신규 |
| `lib/types.ts` | `CafeKeyword`에 `cafe_name?: string \| null` 추가 |
| `components/dashboard/MainPanel.tsx` | 카페 필드 + 탭 토글 |
| `components/dashboard/CafeStatsPanel.tsx` | 신규 |

## 마이그레이션 적용 방식

Supabase MCP의 `apply_migration` 사용. SQL 1줄이라 안전.

## Risk Register

| ID | 위험 | 완화 |
|---|---|---|
| RK-1 | shortcut 추출 정규식이 일부 URL 미매치 | "미분류" 폴백 |
| RK-2 | 사용자 입력 변동성 ("부산맘", "부산맘카페" 분리 합산) | v1은 그대로. 추후 dropdown 자동완성 검토 |
| RK-3 | 3개월 윈도우 경계 (월말 → 월초 전환) | KST 기준 month 산출, 표준 라이브러리 사용 |

## Success Criteria

- 통계 탭 클릭 시 1초 안에 응답
- 기존 248개 키워드도 cafe_name 없이 자동 fallback으로 분류됨
- 새 키워드 추가 시 cafe_name 저장 → 즉시 통계 반영
