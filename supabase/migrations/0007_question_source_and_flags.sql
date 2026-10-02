-- Ảnh cắt gốc của riêng từng câu hỏi (để giáo viên đối chiếu bản số hóa với đề gốc) và thông tin
-- kiểm chứng của bước số hóa (cờ cảnh báo cụ thể, câu chưa đọc được, bản đọc thứ hai...).
-- Code upload đề chạy bình thường (fail-open) nếu migration này chưa chạy: chỉ mất ảnh đối chiếu
-- và cờ có cấu trúc; cảnh báo dạng chữ vẫn được ghi vào raw_ocr_notes.
alter table public.questions
  add column if not exists source_crop_url text,
  add column if not exists extraction_meta jsonb;
