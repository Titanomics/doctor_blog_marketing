-- 카페 글 일별 관측: 조회수·댓글 수·생존 여부. 글 단위(카페 이름 + 글 번호)로 하루 한 행.
create table if not exists public.cafe_post_stats (
  cafe          text        not null,
  article_id    text        not null,
  tracked_date  date        not null,              -- KST 날짜
  status        text        not null check (status in ('alive', 'deleted')),
  read_count    integer,                           -- 누적 조회수 (alive일 때만)
  comment_count integer,
  club_id       text,                              -- 카페 숫자 ID
  member_count  integer,                           -- 카페 회원 수
  observed_at   timestamptz not null default now(),
  primary key (cafe, article_id, tracked_date)
);
create index if not exists cafe_post_stats_date_idx on public.cafe_post_stats (tracked_date);
alter table public.cafe_post_stats enable row level security;

-- 등록 URL → 글 식별자 매핑 보존 (naver.me·숫자 ID URL을 매번 다시 해석하지 않기 위함)
-- post_ref_url 은 매핑을 만들 때의 post_url. post_url 이 바뀌면 다시 해석한다.
alter table public.cafe_keywords
  add column if not exists post_cafe       text,
  add column if not exists post_article_id text,
  add column if not exists post_ref_url    text;
