-- 제품 언급 순위 스캔
-- scanned_posts: 한 번 읽은 블로그·카페 글의 본문 보관 (같은 글을 며칠간 다시 요청하지 않기 위함)
create table if not exists public.scanned_posts (
  post_key   text        primary key,          -- blog:<블로그ID>/<글번호> 또는 cafe:<카페이름>/<글번호>
  kind       text        not null,             -- blog / cafe
  status     text        not null,             -- ok / restricted / deleted / unsupported
  title      text,
  body       text,
  comments   jsonb       not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
alter table public.scanned_posts enable row level security;

-- mention_scans: 스캔 기록 (키워드별로 언제 몇 위였는지 다시 볼 수 있게)
create table if not exists public.mention_scans (
  id         bigint generated always as identity primary key,
  keyword    text        not null,
  terms      text[]      not null,
  kst_date   date        not null,
  scanned_at timestamptz not null default now(),
  summary    jsonb       not null,
  results    jsonb       not null
);
create index if not exists mention_scans_scanned_at_idx on public.mention_scans (scanned_at desc);
alter table public.mention_scans enable row level security;
