-- 수집 실패 기록. 실패한 날에는 순위를 덮어쓰지 않으므로, 이 기록이 있어야 "실패"와 "아직 수집 전"을 구분할 수 있다.
create table if not exists public.collect_failures (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  kst_date    date        not null,
  mode        text        not null,   -- blog / cafe / reporter
  keyword_id  uuid,
  kind        text        not null,   -- serp / resolve / db / history / other
  detail      text
);
create index if not exists collect_failures_date_idx on public.collect_failures (kst_date, mode);
alter table public.collect_failures enable row level security;
