# Nền tảng Thi Trực tuyến Tự động hóa bằng AI

Web thi trực tuyến serverless (Next.js + Supabase): giáo viên upload đề thi Word/PDF, pipeline
Python tự bóc tách công thức toán (LaTeX) + hình ảnh, giáo viên duyệt lại rồi tạo phòng thi;
học sinh vào thi bằng mã phòng, hệ thống chấm điểm cứng (non-AI) và ghi log chống gian lận.

Xem phân tích khả thi đầy đủ, 3 nhánh xử lý input, và các đánh đổi kiến trúc tại kế hoạch gốc
(đã thống nhất với người dùng trước khi code).

## Cấu trúc dự án

```
edu/
├── src/app/            Next.js App Router — dashboard giáo viên, trang thi học sinh, API routes
├── src/lib/            Supabase client helpers, logic chấm điểm (scoring), xáo đề (shuffle)
├── src/components/     UI components (QuestionEditor, Latex renderer, ...)
├── src/types/exam.ts   Type definitions dùng chung (khớp JSON schema của pipeline)
├── supabase/migrations/0001_init.sql   Schema DB + RLS policies + Storage bucket
├── pipeline/           Script Python trích xuất đề thi (chạy ĐỘC LẬP, không phải Vercel function)
└── vercel.json         Cấu hình Vercel Cron (giữ ấm Supabase free tier)
```

## Bước 1 — Tạo Supabase project (BẮT BUỘC, phải tự làm)

Tôi không thể tự tạo tài khoản/project thay bạn. Làm theo các bước sau:

1. Vào https://supabase.com → New Project (free tier).
2. Vào **SQL Editor**, dán toàn bộ nội dung [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) và chạy (tạo bảng, RLS, Storage bucket `exam-images`).
3. Vào **Project Settings → API**, copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**giữ bí mật**, chỉ dùng server-side)
4. Vào **Authentication → Email**, bật "Confirm email" tuỳ nhu cầu (tắt đi nếu muốn test nhanh không cần xác nhận email).

## Bước 2 — Cấu hình biến môi trường

```bash
cp .env.local.example .env.local
# rồi điền các giá trị lấy được ở Bước 1
```

## Bước 3 — Chạy thử local

```bash
npm install
npm run dev
```

Mở http://localhost:3000 → **Giáo viên đăng nhập** → Đăng ký tài khoản → Tạo đề thi.

## Bước 4 — Trích xuất đề thi mẫu bằng pipeline

```bash
cd pipeline
pip install -r requirements.txt
export GEMINI_API_KEY=xxxx   # lấy miễn phí tại https://aistudio.google.com/apikey
python extract.py "path/to/De.docx" --out output/de1
```

Xem chi tiết tại [`pipeline/README.md`](pipeline/README.md), bao gồm bảng 3 nhánh xử lý
(OMML native / MathType cũ / PDF ảnh) và giới hạn đã biết của từng nhánh.

Sau khi có `output/de1/exam.json` + `output/de1/images/`, vào Dashboard → Tạo đề thi mới →
import 2 thứ đó → **Review UI bắt buộc phải duyệt hết câu hỏi** trước khi tạo phòng thi (OCR/LLM
không bao giờ chính xác 100%).

## Bước 5 — Deploy production lên Vercel

Tôi không có quyền tạo tài khoản Vercel hay đăng nhập thay bạn — cần bạn tự chạy:

```bash
npm install -g vercel
vercel login
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production
vercel --prod
```

Hoặc: push code lên GitHub → import repo tại https://vercel.com/new → điền các biến môi trường
trên trong phần Environment Variables → Deploy.

`vercel.json` đã cấu hình sẵn Cron gọi `/api/cron/keepalive` 2 lần/tuần để tránh Supabase free
tier tự pause sau 7 ngày không hoạt động.

## Giới hạn cần biết trước khi dùng thật

- **OCR/LaTeX không bao giờ 100% chính xác** — Review UI là bước bắt buộc, không bỏ qua.
- **Anti-cheat là deterrent + logging**, không chặn tuyệt đối học sinh rành kỹ thuật (xem
  `src/hooks/useAntiCheat.ts`) — giáo viên tự quyết định dựa trên log vi phạm.
- **Nhánh MathType cũ (WMF)** cần cài LibreOffice trên máy chạy pipeline để tự động OCR; không
  có thì vẫn chạy được nhưng cần nhập tay công thức đó.
- **Supabase free tier** pause sau 7 ngày không hoạt động — cron giữ ấm đã cấu hình nhưng vẫn
  cần theo dõi nếu dùng thật với học sinh.
