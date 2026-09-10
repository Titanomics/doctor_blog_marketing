-- 블로그기자단 entries에 발행일(게시일) 컬럼 추가
-- Supabase 대시보드 SQL Editor에서 실행
ALTER TABLE reporter_blog_entries
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
