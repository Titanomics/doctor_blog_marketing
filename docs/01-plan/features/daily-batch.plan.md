# daily-batch — Plan (회고 작성)

- **Feature**: daily-batch
- **Phase**: Plan (역공학 회고)
- **Date**: 2026-05-02
- **Status**: 운영 중 (Vercel cron)

> 본 문서는 사실상 운영 중인 daily-batch 시스템에 대해 PDCA 추적성을 확보하기 위한 사후 정리입니다. 2026-04-22 Gap Analysis 1회차, 2026-05-02 Gap Analysis 2회차의 결과를 반영했습니다.

## Executive Summary

| 관점 | 내용 |
|---|---|
| **Problem** | 네이버 검색에서 클라이언트(병원/카페 브랜드/기자단)의 키워드 노출 순위를 매일 자동 추적해야 함. 수동 새로고침은 운영 부담이 큼 |
| **Solution** | Vercel Cron이 매일 정해진 시각에 `/api/daily-batch`를 호출 → 3개 도메인(블로그/카페/기자단) 부모 batch-track으로 fan-out → 각 부모가 클라이언트별로 fan-out (서버리스 함수 60s 제한 회피) |
| **Function/UX Effect** | 사용자는 대시보드에서 자동 갱신된 순위를 그대로 확인. 추가로 수동 "전체 갱신/개별 갱신" 버튼 (1시간/5분 쿨다운) |
| **Core Value** | 운영 자동화 + 데이터 신선도 + 비용 통제 (Vercel Hobby 60s 제한 내 처리) |

## Context Anchor

| 항목 | 값 |
|---|---|
| **WHY** | 매일 키워드 순위를 사람이 일일이 확인할 수 없음 / 검색 결과는 캐싱 없이 매번 가져와야 신뢰 가능 |
| **WHO** | 김경록(운영) / 진선/지수(컨텐츠/마케팅 모니터링) |
| **RISK** | Vercel Hobby 60s 제한 / 네이버 검색 차단 / 부모 응답 후 자식 종료 / 외부 무단 호출 (DoS) |
| **SUCCESS** | 1) 매일 자동 갱신 99%+ 도달, 2) 수동 새로고침 ≤ 5분, 3) UI ↔ 메일 데이터 일치성 |
| **SCOPE** | daily-batch cron + 3개 부모 fan-out + 카페 삭제 감지 + 대시보드 표기 + 메일 (별도 cron) |

## Requirements

### 기능 요구사항
- **R-1**: cron 1회/일에 daily-batch 실행 (현재: KST 03시)
- **R-2**: daily-batch는 블로그/카페/기자단 3개 도메인을 동시 트리거
- **R-3**: 각 도메인 부모는 클라이언트별로 fan-out하여 60s 제한 회피
- **R-4**: 카페 키워드의 경우 매칭 실패 + 특정 게시글 URL이 있으면 삭제 여부 자동 감지
- **R-5**: 사용자는 대시보드에서 개별/전체 키워드 수동 갱신 가능 (쿨다운 적용)
- **R-6**: 사용자는 대시보드에서 키워드/URL/제목/작성자를 인라인 수정 가능
- **R-7**: 사용자는 게시글이 삭제되었음을 수동으로 표시/해제 가능 (자동 감지가 덮어쓰지 않음)

### 비기능 요구사항
- **NR-1**: Vercel Cron 외 외부 호출은 401 거부 (CRON_SECRET 또는 vercel-cron user-agent로 인증)
- **NR-2**: 검색 결과 페이지/API에 `cache: 'no-store'` 적용 (UI ↔ 메일 일치성)
- **NR-3**: 동적 라우트는 `force-dynamic` + `Cache-Control: no-store`
- **NR-4**: PATCH 라우트는 화이트리스트 필드만 허용 (보안)

## Success Criteria

| ID | 기준 | 측정 |
|---|---|---|
| **SC-1** | daily-batch 일일 성공률 ≥ 99% | Vercel cron logs |
| **SC-2** | 자동 매칭 성공률 (Top 7 노출) ≥ 90% | DB current_rank 분포 |
| **SC-3** | 수동 새로고침 응답 시간 ≤ 5초 (개별), ≤ 60초 (전체) | 클라이언트 측정 |
| **SC-4** | 외부 무단 호출 차단율 100% | NR-1 인증 |
| **SC-5** | 카페 삭제 게시글 자동 감지 정확도 ≥ 95% | API 4003 errorCode 매칭 |
| **SC-6** | 사용자 수동 "삭제표시"가 다음 배치에서 보존 | 2026-05-02 G2 수정으로 충족 |

## Risk Register

| ID | 리스크 | 완화 |
|---|---|---|
| **RK-1** | Vercel Hobby 60s 제한 → 큰 클라이언트군 처리 실패 | per-client fan-out + Promise.allSettled로 부모 응답 보장 |
| **RK-2** | 네이버 IP 차단 | DELAY_MS=800ms 사이 간격 + 표준 Chrome User-Agent |
| **RK-3** | CRON_SECRET 미설정 시 외부 DoS | NODE_ENV=production이고 미설정이면 401 (R4 수정으로 충족) |
| **RK-4** | 일시적 카페 API 장애 → 정상 게시글이 false 반환되어 잘못 갱신 | getCafePostStatus 'unknown' 분류 + 보존 로직 (R2 수정으로 충족) |
| **RK-5** | 모바일 URL(m.cafe.naver.com) 입력 시 매칭 비일관 | 정규화 통일 (G3 수정으로 충족) |
