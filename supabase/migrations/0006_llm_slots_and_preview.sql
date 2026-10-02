-- ----------------------------------------------------------------------------
-- Giới hạn số lượt gọi Gemini đồng thời trên toàn hệ thống (tránh nhiều giáo
-- viên upload cùng lúc dồn dập gây 429/503 hàng loạt) — xem acquireGeminiSlot()
-- trong src/lib/extraction/llmClient.ts. Mỗi lượt gọi Gemini giữ 1 "slot" có hạn
-- (expires_at) trong lúc chờ phản hồi; slot hết hạn tự được dọn ở lần gọi kế tiếp
-- nên không cần cron riêng.
-- ----------------------------------------------------------------------------
create table if not exists public.llm_call_slots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.llm_call_slots enable row level security;
-- Chỉ service-role (dùng trong llmClient.ts, server-side) được truy cập — không
-- có policy nào cho anon/authenticated nên RLS mặc định chặn hết, service role
-- bỏ qua RLS theo thiết kế Supabase.

create index if not exists llm_call_slots_expires_at_idx on public.llm_call_slots (expires_at);

-- ----------------------------------------------------------------------------
-- File PDF xem trước đã convert (qua CloudConvert) để giáo viên đối chiếu song
-- song với đề đã trích xuất — khác với original_file_url (file gốc .docx/.pdf/
-- ảnh để TẢI VỀ nguyên bản). Trình duyệt không tự render được .docx nên cần bản
-- PDF riêng để hiển thị trực tiếp trong <iframe>.
-- ----------------------------------------------------------------------------
alter table public.exams
  add column if not exists original_preview_url text;
