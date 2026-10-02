-- ============================================================================
-- Lưu lại file đề gốc giáo viên upload để hiển thị song song khi duyệt (đối
-- chiếu đề gốc với đề đã trích xuất, dễ phát hiện lỗi OCR/ảnh sai)
-- ============================================================================

alter table public.exams
  add column if not exists original_file_url text,
  add column if not exists original_file_ext text;
