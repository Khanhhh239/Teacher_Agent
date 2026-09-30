import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client dùng service-role key, bỏ qua RLS — CHỈ dùng trong Route Handlers phía server
 * cho luồng học sinh (không đăng nhập) truy cập phòng thi/nộp bài.
 * Không bao giờ import file này vào code chạy ở client.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
