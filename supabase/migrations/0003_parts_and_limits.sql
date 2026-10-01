-- ============================================================================
-- Thêm part_label cho câu hỏi (PHẦN I/II/III, giữ nguyên thứ tự khi xáo trộn)
-- và giới hạn cấu hình được cho phòng thi (số lần nộp bài, số vi phạm bị đuổi)
-- ============================================================================

alter table public.questions
  add column if not exists part_label text;

alter table public.exam_rooms
  add column if not exists max_attempts integer not null default 1,
  add column if not exists violation_kick_limit integer not null default 1;

alter table public.exam_sessions
  add column if not exists kicked_at timestamptz;
