import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// 서버 전용 모듈. SUPABASE_SERVICE_ROLE_KEY가 있으면 그것으로 접속한다(RLS 적용 후 필수).
// 없으면 기존 anon 키로 동작 — RLS를 켜기 전까지의 과도기용.
if (typeof window !== "undefined") {
  throw new Error("lib/supabase는 서버에서만 import해야 합니다.");
}

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY 미설정 — anon 키로 접속 중");
}

export const usingServiceRole = !!serviceRoleKey;

export const supabase = createClient(
  supabaseUrl,
  serviceRoleKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
