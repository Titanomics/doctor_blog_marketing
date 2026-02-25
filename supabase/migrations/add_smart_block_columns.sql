-- keywords 테이블에 스마트블록 컬럼 추가
ALTER TABLE public.keywords
  ADD COLUMN IF NOT EXISTS smart_block_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS smart_block_rank integer DEFAULT NULL;
