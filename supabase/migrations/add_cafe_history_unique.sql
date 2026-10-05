-- cafe_keyword_history 에 (keyword_id, tracked_date) 유니크 제약이 없어
-- saveCafeHistory 의 upsert(onConflict) 가 매번 42P10 오류로 실패하고 있었다 (이력 0건).
-- keyword_history / reporter_blog_history 와 같은 형태로 맞춘다.
alter table public.cafe_keyword_history
  add constraint cafe_keyword_history_keyword_date_key unique (keyword_id, tracked_date);
