# Cafe Stats Follow-up Design

- **Date**: 2026-06-08
- **Topic**: 카페 통계 1차 (2026-05-17) 후속 — 자동 추출 제거 + 엑셀 + 등록일 수정
- **Approved**: 사용자 (A + B)

## 요구사항

| ID | 내용 | 결정 |
|---|---|---|
| **R1** | 카페 이름 자동 작성 기능 제거 (행 라벨/UI) | 자동 분기 삭제, cafe_name 있으면 표시 / 없으면 "미분류" |
| **R2** | 통계에 cafe_name 있는 것만 정확히 합산 + 미분류 그룹 별도 표시 (B안) | shortcut 추출 제거, `미분류 N건` 별도 그룹으로 보존 |
| **R3** | 엑셀 리포트에 카페이름 컬럼 추가 | J 컬럼 신설 |
| **R4** | 엑셀 다운로드 = 전체 항목 (A안) | 변동 필터 제거 |
| **R5** | 등록일 수정 기능 (캘린더) | `<input type="date">` + PATCH `created_at` |
| **R6** (보류) | 카페글 작성일 표시 | 우선순위 낮음, 백로그 |

## 변경 사항

### R1 + R2 — 자동 추출 제거
- `MainPanel.getCafeDisplay()`: `source = "user" | "none"` 두 가지만. shortcut 추출 코드 삭제
- 행 라벨:
  - cafe_name 있음 → 보라색 `📍 부산맘카페`
  - 없음 → 빨간색 `📍 미분류 ✏️` (클릭 시 편집)
- `/api/cafe/stats`:
  - `extractShortcut()` 함수 제거
  - 분류 로직: `cafe_name` 있으면 그대로, 없으면 `"미분류"` 그룹
  - source 타입: `"user" | "unclassified"`

### R3 + R4 — 엑셀
`lib/generateCafeReport.ts` (현 export 경로 확인 후):
- 컬럼 추가: `카페이름` (값: `cafe_name ?? ""`)
- "변동만" 필터 코드 삭제 → 전체 키워드 export
- 시트 헤더 순서: 브랜드명 / 키워드 / 현재순위 / 이전순위 / 변동 / 노출URL / 포스팅URL / 포스팅제목 / **카페이름**

### R5 — 등록일 수정
- `MainPanel.tsx`:
  - `editingCreatedAt` state 추가
  - 편집 시작 시 `(kw.created_at).slice(0, 10)` 으로 초기화 (YYYY-MM-DD)
  - 인라인 편집 폼 PC + 모바일에 `<input type="date">` 추가 (카페 이름 옆 또는 아래)
  - `handleSaveEdit` body에 `created_at: editingCreatedAt ? new Date(editingCreatedAt + "T00:00:00+09:00").toISOString() : undefined`
- `app/api/cafe/keywords/route.ts`:
  - `ALLOWED_PATCH_FIELDS`에 `"created_at"` 추가

## 영향 파일

| 파일 | 변경 |
|---|---|
| `components/dashboard/MainPanel.tsx` | getCafeDisplay 단순화, 행 라벨, 편집 폼 date input + state |
| `app/api/cafe/stats/route.ts` | shortcut 제거, source 2개 |
| `app/api/cafe/keywords/route.ts` | PATCH 화이트리스트에 created_at |
| `lib/generateCafeReport.ts` (또는 export route) | 카페이름 컬럼, 변동 필터 제거 |

## Risk Register

| ID | 위험 | 완화 |
|---|---|---|
| RK-1 | `created_at` 변경이 통계 월 합산에 영향 (다른 월로 이동) | 의도된 동작 — 통계 정확도 ↑ |
| RK-2 | UTC 변환 실수 (KST 자정 입력 → UTC 전날 15:00) | `+09:00` suffix 명시로 KST 자정으로 고정 |
| RK-3 | 자동 분류 제거 시 기존 5월 "미분류 19건"이 더 크게 보임 | 의도된 동작 (B안) — 사용자 분류 동기 부여 |

## Success Criteria

- 행 표시에 "(자동)" 라벨 0건
- 통계 탭에서 cafe_name 있는 것만 정확 합산 + "미분류" 그룹 표시
- 엑셀 J 컬럼에 카페이름 채워짐, 전체 키워드 export
- 인라인 편집에서 등록일 변경 → 통계 월 그룹 즉시 이동
