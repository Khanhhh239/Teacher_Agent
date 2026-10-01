-- Một câu hỏi có thể có nhiều hơn 1 hình vẽ minh họa (vd: câu hình học mô tả 2 hình liên
-- tiếp) — cột image_url (string đơn) không đủ, chuyển sang mảng image_urls.

alter table public.questions add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.questions
set image_urls = case when image_url is not null then jsonb_build_array(image_url) else '[]'::jsonb end
where image_urls = '[]'::jsonb;

alter table public.questions drop column if exists image_url;
