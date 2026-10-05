-- 키워드 검색량 (네이버 검색광고 API). 값은 조회일 기준 "최근 30일 합계"이며 키워드마다 주 1회 저장한다.
-- keyword 는 공백 제거·대문자로 정규화한 형태. pc/mobile: null = API가 값을 주지 않음, 0 = 10 미만.
create table if not exists public.keyword_volumes (
  keyword      text        not null,
  tracked_date date        not null,
  pc           integer,
  mobile       integer,
  observed_at  timestamptz not null default now(),
  primary key (keyword, tracked_date)
);
alter table public.keyword_volumes enable row level security;
