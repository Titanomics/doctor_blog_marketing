-- RLS 활성화: anon/authenticated 역할의 직접 접근(Supabase REST)을 전면 차단한다.
-- 정책을 만들지 않으므로 service_role(서버) 만 읽고 쓸 수 있다.
--
-- ⚠️ 적용 순서 (어기면 대시보드·배치가 전부 멈춤)
--   1. Vercel 환경변수와 .env.local 에 SUPABASE_SERVICE_ROLE_KEY 추가
--   2. 재배포 후 Vercel 로그에
--      "[supabase] SUPABASE_SERVICE_ROLE_KEY 미설정" 경고가 더 이상 없는지 확인
--   3. 이 SQL 실행
--   4. anon 키로 REST 조회 시 빈 배열([])이 나오는지 확인

alter table public.clients               enable row level security;
alter table public.keywords              enable row level security;
alter table public.keyword_history       enable row level security;
alter table public.cafe_clients          enable row level security;
alter table public.cafe_keywords         enable row level security;
alter table public.cafe_keyword_history  enable row level security;
alter table public.reporter_keywords     enable row level security;
alter table public.reporter_blog_entries enable row level security;
alter table public.reporter_blog_history enable row level security;

-- 기존에 만들어 둔 허용 정책이 있으면 RLS를 켜도 남는다. 아래로 확인 후 필요 시 삭제:
--   select schemaname, tablename, policyname, roles, cmd from pg_policies where schemaname = 'public';
