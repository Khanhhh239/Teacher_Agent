-- detectDocxBranch() (src/lib/extraction/docxExtract.ts) trả về "NO_MATH_DETECTED"
-- cho các file .docx không có công thức nào (không <m:oMath>, không <w:object>) — một
-- đề thi thuần text hoàn toàn hợp lệ. Constraint cũ thiếu giá trị này nên mọi đề thi
-- dạng đó bị lỗi "violates check constraint" ngay khi tạo exam.
alter table public.exams drop constraint if exists exams_source_branch_check;
alter table public.exams add constraint exams_source_branch_check
  check (source_branch in ('OMML_NATIVE', 'LEGACY_OLE_IMAGE', 'PDF_IMAGE_ONLY', 'PDF_TEXT_LAYER', 'NO_MATH_DETECTED', 'MANUAL'));
