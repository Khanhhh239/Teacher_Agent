# Kế hoạch hoàn thiện nền tảng thi trực tuyến và pipeline số hóa đề bằng AI

> Tài liệu bàn giao cho Agent/kỹ sư khác. Ngày lập: 2026-10-02. Repo: `C:\Users\Admin\Downloads\edu` (GitHub `Khanhhh239/Teacher_Agent`, nhánh `main`, commit gần nhất lúc lập tài liệu `7f1ee6a`). Production: https://edu-kappa-livid.vercel.app
>
> **Quy ước nguồn số liệu**: mục nào ghi **[ĐÃ ĐO]** là kết quả thí nghiệm thật chạy trong phiên làm việc này (có thể lặp lại). **[ƯỚC TÍNH]** là tính toán lý thuyết, chưa đo. **[KHẢO SÁT CODE]** là đọc từ mã nguồn ngày lập tài liệu. Agent nhận việc phải đo lại mọi mục [ƯỚC TÍNH] trước khi tin.

## Mục lục

1. Mục tiêu sản phẩm và tiêu chí thành công
2. Kiến trúc, hạ tầng, giới hạn nền tảng
3. Danh mục chức năng toàn web (theo module, kèm trạng thái và việc cần làm)
4. Hiện trạng pipeline số hóa đề và nhật ký lỗi
5. Dữ liệu thực nghiệm đã có (bằng chứng)
6. Kế hoạch chất lượng mới: Phân đoạn → Đọc → Kiểm chứng → Duyệt
7. Thiết kế lưới tọa độ (ý tưởng của chủ dự án) và phân đoạn bằng lớp chữ PDF
8. Mô hình chi phí và thời gian
9. Bộ thí nghiệm (E1–E16)
10. Backlog sản phẩm theo ưu tiên
11. Tiêu chí nghiệm thu (Definition of Done)
12. Phụ lục: quy tắc làm việc, lưu ý môi trường, dữ liệu mẫu, lệnh hay dùng

---

## 1. Mục tiêu sản phẩm và tiêu chí thành công

### 1.1 Sản phẩm là gì
Web thi trực tuyến cho giáo viên Việt Nam (đề THPT: Toán, Lý, Hóa...). Luồng chính:

1. Giáo viên upload **file đề** và **file đáp án** (docx, pdf hoặc ảnh).
2. AI số hóa đề thành câu hỏi có cấu trúc (trắc nghiệm, đúng/sai nhóm 4 ý, điền đáp án ngắn), công thức LaTeX, hình minh họa.
3. Giáo viên duyệt và sửa (đối chiếu với đề gốc), xác nhận.
4. Giáo viên tạo phòng thi (mã 6 ký tự), học sinh vào thi không cần tài khoản.
5. Hệ thống xáo trộn câu và phương án theo từng học sinh, bấm giờ, tự lưu bài, chống gian lận mức răn đe, chấm tự động.
6. Giáo viên xem điểm, thống kê, vi phạm, xuất CSV.

### 1.2 Yêu cầu chất lượng do chủ dự án đặt ra (bắt buộc)
- Đề sau số hóa **phải đúng tuyệt đối** nội dung gốc. Ví dụ lỗi không chấp nhận: mất dấu giá trị tuyệt đối `|f(x)|` làm phương án A trông hợp lý nhưng sai nghĩa; nuốt cả câu hỏi vào tiêu đề "PHẦN III"; gán sai loại câu; hình dư/thiếu/gán nhầm.
- Mỗi đề **5–6 trang** (khoảng 22 câu): **chi phí token dưới 10.000đ**, **thời gian dưới 10 phút**.
- Chấp nhận kiến trúc "AI làm, máy kiểm tra chéo, người soát nhanh". **Không có AI nào đảm bảo 0% sai nếu tự chạy một mình**; cam kết thực tế là: câu nào AI không chắc thì bị gắn cờ, câu qua mọi lớp kiểm tra thì xác suất sai rất thấp, giáo viên soát đối chiếu ảnh gốc trong vài phút.

### 1.3 KPI đề xuất (đo trên bộ dữ liệu vàng, xem mục 9.1)
| KPI | Mục tiêu |
|---|---|
| Câu đúng hoàn toàn (khớp từng ký hiệu sau chuẩn hóa) khi KHÔNG có người soát | ≥ 97% |
| Lỗi nội dung KHÔNG bị gắn cờ (lỗi im lặng) | ≤ 1 câu / 50 câu |
| Sau khi giáo viên soát các câu bị gắn cờ | 100% đúng |
| Chi phí token một đề 22 câu (đo bằng `usageMetadata`) | < 10.000đ, mục tiêu trung bình ~4.000–6.000đ |
| Thời gian từ bấm "Tiếp tục" đến mở được trang duyệt | < 10 phút, mục tiêu 3–5 phút |
| Tỉ lệ upload bị lỗi cứng (HTTP 500/timeout) | < 1% |

---

## 2. Kiến trúc, hạ tầng, giới hạn nền tảng

### 2.1 Stack [KHẢO SÁT CODE]
- Next.js **16.3.x** (App Router, Turbopack), React 19, TypeScript. Thư viện chính: `@supabase/ssr`, `@supabase/supabase-js`, `react-katex` + `katex`, `sharp`, `mupdf` (WASM, render PDF), `jszip` + `@xmldom/xmldom` (đọc docx), `undici` (gọi Gemini với timeout dài).
- Supabase: Postgres + RLS, Auth (email/password cho giáo viên), Storage (bucket `exam-images`, **public**).
- Vercel (Node runtime) cho web và API. `src/proxy.ts` là middleware kiểu Next 16, chỉ chặn `/dashboard/*`.
- LLM: Gemini (`gemini-3.5-flash-lite` cho cả text và vision), DeepSeek (chỉ text, dự phòng), OpenRouter Qwen (vision dự phòng, rất không ổn định).
- CloudConvert (docx→PDF) chỉ còn dùng tạo **bản xem trước PDF** cho docx; **hiện hết credit** (lỗi 402) nên tính năng này đang tắt ngầm.

**Quy tắc bắt buộc từ `AGENTS.md`**: đây không phải Next.js quen thuộc; đọc `node_modules/next/dist/docs/` trước khi viết code và chú ý các thay đổi/deprecation.

### 2.2 Giới hạn nền tảng đã gặp thực tế [ĐÃ ĐO]
| Giới hạn | Hệ quả | Cách xử lý hiện tại |
|---|---|---|
| Vercel body request ~4.5MB | Upload file lớn bị 413, frontend báo lỗi "Unexpected token 'R'" | Trình duyệt upload thẳng lên Storage (`tmp-uploads/<batch>/...`), API chỉ nhận đường dẫn |
| `maxDuration` của route extract = 280s | Xử lý tuần tự đề + đáp án mất tới 195s, có lúc vượt 280s → Vercel trả trang lỗi HTML | Xử lý đề và đáp án song song; frontend đọc phản hồi dạng text rồi mới parse JSON |
| Gemini free tier hạn mức theo phút | 429 dồn dập khi test nhiều | Code chờ đúng `RetryInfo.retryDelay` Google trả về (tối đa 45s/lần, ~100s/lệnh gọi) |
| Gemini `RECITATION` | Gemini trả `finishReason=RECITATION`, không có nội dung | Xem mục 5 và 6 |
| SVG `<text>` trong `sharp` trên Vercel | Thiếu font hệ thống, chữ thành ô vuông/rác (đã gặp khi từng thử render WMF/EMF) | **Không dùng `<text>` để vẽ chữ trên ảnh phía server**; vẽ chữ số bằng path hoặc sprite PNG (xem mục 7) |
| `tsx` + `mupdf` | Lỗi top-level await/ESM trên Node 24 | Viết script chẩn đoán dùng `mupdf` bằng `.mjs` chạy trực tiếp `node` |

### 2.3 Biến môi trường (chỉ tên; **không bao giờ in giá trị**)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `LLM_PROVIDER`, `CLOUDCONVERT_API_KEY`, `DEBUG_EXTRACT_JSON`.

Lưu ý: dòng `SUPABASE_SERVICE_ROLE_KEY` trong `.env.local` trên máy chủ dự án **bị lẫn ký tự tiếng Việt** (hỏng khi dùng cục bộ). Giá trị đúng nằm trên Vercel; lấy bằng `vercel env pull .env.vercel.tmp --environment=production --yes`, dùng xong **xóa file**. Tệp `.env*` đã nằm trong `.gitignore`.

### 2.4 Triển khai
`git push origin main` (cập nhật GitHub) **và** `vercel --prod` (deploy). Hai việc tách biệt, luôn làm cả hai. Thêm biến môi trường một dòng: dùng `printf` rồi pipe vào `vercel env add NAME production` (dùng `echo` sẽ thêm ký tự xuống dòng làm hỏng so sánh chuỗi).

---

## 3. Danh mục chức năng toàn web

Trạng thái: **[XONG]** hoạt động, **[MỘT PHẦN]** có nhưng thiếu, **[THIẾU]** chưa có. Nguồn: [KHẢO SÁT CODE] ngày 2026-10-02.

### M1. Tài khoản giáo viên
| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Đăng ký `/signup`, đăng nhập `/login` (Supabase Auth), đăng xuất `/api/auth/logout` | XONG | Trigger DB `handle_new_teacher` tạo hồ sơ `teachers`. Mọi người đăng ký đều là giáo viên, chưa có vai trò khác |
| Bảo vệ `/dashboard/*` bằng `src/proxy.ts` | XONG | Các trang ngoài `/dashboard` và mọi `/api/*` KHÔNG được proxy bảo vệ, từng route tự kiểm tra |
| Quên mật khẩu, đổi mật khẩu, xác minh email | THIẾU | Phụ thuộc cấu hình Supabase |
| Trang hồ sơ, thống kê sử dụng, hạn mức | THIẾU | Cần nếu thương mại hóa |

### M2. Tạo đề và số hóa (module trọng tâm, xem mục 4–9)
| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Trang `/dashboard/exams/new`: 2 ô upload (đề, đáp án đều bắt buộc), môn, thời gian | XONG | Chấp nhận docx, pdf, jpg, jpeg, png, webp |
| Upload thẳng Storage rồi gọi `POST /api/exams/extract-upload` | XONG | Bỏ qua giới hạn 4.5MB |
| Nhánh docx hiện đại (công thức Word OMML) → LaTeX bằng code, rồi AI cấu trúc hóa | XONG | Chính xác công thức 100% (không qua AI đọc công thức) |
| Docx MathType/WMF cũ | Từ chối ngay (400), yêu cầu "Save As PDF" | Trước đây fallback CloudConvert nhưng hết credit |
| PDF/ảnh: đọc từng trang bằng Gemini vision | MỘT PHẦN | Có nhiều lỗi chất lượng, **cần thay bằng kế hoạch mục 6** |
| Đáp án: đọc từ docx/pdf/ảnh, ghép theo số thứ tự, **file đáp án quyết định loại câu** | XONG | Có cảnh báo thiếu đáp án, lệch số lượng, câu loại không khớp |
| Hàng đợi giới hạn Gemini đồng thời (bảng `llm_call_slots`, tối đa 4) | XONG | Fail-open nếu bảng lỗi |
| Telemetry chi phí/token mỗi lệnh gọi | THIẾU | **Bắt buộc làm** (mục 8.4) |
| Tiến độ xử lý (progress bar), chạy nền, tiếp tục khi lỗi giữa chừng | THIẾU | Hiện là 1 request dài tối đa 280s, không có tiến độ, không thể resume |
| Tạo đề thủ công / thêm câu / nhập từ JSON | THIẾU | Chuỗi UI nhắc "thêm thủ công" nhưng không có tính năng |
| Tạo exam không có transaction | RỦI RO | Lỗi giữa chừng để lại đề dở dang |

### M3. Duyệt và chỉnh sửa
| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Trang `/dashboard/exams/[examId]`: chia đôi màn hình kéo thanh (câu hỏi trái, đề gốc phải) | XONG | `ResizableSplitView`, phần phải 4–96% |
| `OriginalFileViewer`: PDF/ảnh hiển thị trực tiếp; docx dùng bản xem trước PDF nếu có | MỘT PHẦN | Bản xem trước docx đang tắt vì hết credit CloudConvert |
| `QuestionEditor`: sửa LaTeX, phương án, đáp án đúng, điểm, loại điểm đúng/sai, xem trước trực tiếp | XONG | Đáp án AI đề xuất hiện màu đỏ cho đến khi bấm "Xác nhận" |
| Thay ảnh: chọn file hoặc dán Ctrl+V | XONG | Không xóa ảnh cũ khỏi Storage |
| Hiển thị **ảnh crop gốc của từng câu** cạnh bản số hóa | THIẾU | Là lớp phòng thủ số 5 (mục 6.7) |
| Cờ cảnh báo theo câu (lý do cụ thể), sắp xếp câu nghi ngờ lên đầu | THIẾU | Hiện chỉ có `needs_review` cho tất cả và `raw_ocr_notes` |
| Sửa `part_label` (PHẦN), `type`, thứ tự câu, thêm/xóa phương án, thêm/xóa câu, thêm/xóa ảnh | THIẾU | Hiện không sửa được |
| `ExamPreviewModal` xem trước giao diện học sinh rồi "Xác nhận tạo đề thi" | XONG | Xác nhận = gỡ `needs_review` mọi câu rồi đặt `status=ready` (2 lệnh rời, không transaction) |
| Trạng thái đề: chỉ có chuyển X → `ready`; không có `draft` UI, `archived` UI, hoặc quay lại | MỘT PHẦN | |
| Xóa đề (`DeleteExamButton`, confirm) | MỘT PHẦN | Cascade DB nhưng **file Storage bị bỏ rơi** |

### M4. Phòng thi
| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| Tạo phòng: mã 6 ký tự (`Math.random`), bắt buộc toàn màn hình, số lần thi tối đa, ngưỡng đuổi vi phạm, mở/đóng | XONG | Tạo thẳng từ trình duyệt qua RLS |
| Bật/tắt phòng (`RoomActiveToggle`) | XONG | |
| `opens_at`/`closes_at` (hẹn giờ mở/đóng) | MỘT PHẦN | API tôn trọng giá trị trong DB, **không có UI** đặt giá trị |
| Sửa phòng sau khi tạo, nhân bản phòng, danh sách học sinh được phép | THIẾU | |
| Chỉ cho tạo phòng khi đề `ready` | THIẾU | Không kiểm tra ở server/RLS; API join cũng không kiểm tra `status=ready` |
| Va chạm mã phòng | RỦI RO | Chỉ dựa ràng buộc UNIQUE, chưa retry |

### M5. Học sinh vào thi và làm bài
| Chức năng | Trạng thái | Ghi chú |
|---|---|---|
| `/exam/join`: mã phòng, họ tên (bắt buộc), SBD (tùy chọn); `POST /api/rooms/[code]/join` | XONG | Không cần tài khoản |
| Giới hạn số lần thi | MỘT PHẦN | Đếm phiên theo SBD hoặc họ tên; **đổi tên/SBD là qua mặt được** |
| Xáo trộn: câu theo nhóm PHẦN, phương án trắc nghiệm theo seed (mulberry32), lưu vào phiên | XONG | Ý đúng/sai KHÔNG xáo; `settings.shuffle_*` không có UI |
| Đồng hồ: server tính `remaining_seconds`, client đếm ngược và tự nộp khi hết giờ | MỘT PHẦN | **Server KHÔNG chặn trả lời/nộp sau khi hết giờ** |
| Tự lưu từng thay đổi (`POST /answer`, upsert) | MỘT PHẦN | Fire-and-forget, nuốt lỗi, không hàng đợi/offline retry |
| Nộp bài, màn hình kết quả có hiển thị đáp án đúng | MỘT PHẦN | Giáo viên không có công tắc ẩn đáp án |
| Bảo mật phiên | RỦI RO | Chỉ UUID phiên làm "bí mật", không rate limit, không token riêng; ai có UUID đọc được đề, gửi đáp án, xem kết quả |
| Giao diện di động, truy cập người khuyết tật | CHƯA KIỂM | |

### M6. Chấm điểm (`src/lib/scoring/index.ts`)
| Loại | Quy tắc hiện tại |
|---|---|
| `multiple_choice` | `selected === correct_answer` → `max_score`, sai → 0 (mặc định 0.25) |
| `true_false_group` + `standard` | Đúng hết các ý mới được `max_score` |
| `true_false_group` + `thpt2025_truefalse_partial` | 1 ý đúng 0.1×max, 2 ý 0.25×max, 3 ý 0.5×max, 4 ý max (mặc định max=1.0); giả định đúng 4 ý |
| `short_answer` | Chuẩn hóa: cắt khoảng trắng, hạ chữ thường, xóa mọi khoảng trắng, thay **dấu phẩy ĐẦU TIÊN** bằng dấu chấm; so khớp chuỗi tuyệt đối với 1 đáp án (mặc định max 0.5) |

Việc cần làm: dung sai số học (0,08 = 0.08 = 8e-2), nhiều đáp án chấp nhận, đơn vị, số ý đúng/sai khác 4. **Phiên bị đuổi** (kick) đặt `status=submitted` rồi lần `/submit` thấy "đã nộp" nên **không bao giờ chấm** (điểm NULL) — cần chốt chính sách (xem mục 10, P0).

### M7. Chống gian lận (`src/hooks/useAntiCheat.ts`)
| Hành vi | Trạng thái | Ghi chú |
|---|---|---|
| Ghi nhận: `tab_blur` (cả `visibilitychange` lẫn `window blur` → 1 lần chuyển tab thường tính 2 vi phạm), `fullscreen_exit`, `right_click`, `devtools_key` (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+P), `copy_paste` (Ctrl+C/V/X) | XONG | |
| Tự đuổi khi `violation_count >= violation_kick_limit` (mặc định 1 → **chuyển tab lần đầu là bị đuổi**) | XONG | Đếm kiểu đọc-sửa-ghi, có race |
| Phím Cmd (macOS), sự kiện copy/paste thật, thay đổi kích thước cửa sổ | THIẾU | Kiểu `window_resize` có khai báo nhưng không phát |
| Xem vi phạm: số lượng trong bảng kết quả, chi tiết ở trang từng học sinh | XONG | |
| Giám sát thời gian thực | THIẾU | Bảng `exam_violations` đã bật Realtime nhưng không có UI đăng ký nghe |
| `exams.settings.anti_cheat` | KHÔNG DÙNG | Hook không đọc cấu hình này |

Nguyên tắc sản phẩm đã thống nhất từ đầu: đây là **răn đe + ghi log**, không phải chặn tuyệt đối.

### M8. Kết quả và thống kê
`/dashboard/exams/[examId]/rooms/[roomId]`: bảng phiên (tên, SBD, trạng thái, điểm, vi phạm, thời điểm nộp, "(bị đuổi)"), `RoomCharts` (SVG tự vẽ: phân phối điểm 5 mức, tỉ lệ đúng theo câu; câu đúng/sai nhóm chỉ tính đúng khi đạt `max_score`), xuất CSV (UTF-8 BOM). Trang chi tiết học sinh: từng câu, đáp án chọn, đáp án đúng, điểm, danh sách vi phạm kèm nhãn tiếng Việt. Thiếu: độ khó/độ phân biệt câu, so sánh phòng, xuất Excel/PDF, lọc/tìm kiếm.

### M9. Vận hành
| Chức năng | Trạng thái |
|---|---|
| Cron giữ Supabase không ngủ: `GET /api/cron/keepalive`, `vercel.json` thứ Ba và thứ Sáu 00:00 UTC; bảo vệ bằng `CRON_SECRET` (nếu không đặt thì **mở**) | XONG |
| Dọn Storage: file tạm `tmp-uploads/*` (route tự xóa), ảnh/bản gốc khi xóa đề | MỘT PHẦN (tạm: xong; xóa đề: thiếu) |
| Telemetry chi phí LLM, log lỗi có cấu trúc, dashboard vận hành | THIẾU |
| Test tự động, CI | THIẾU (chỉ có script thủ công trong `scripts/`) |
| `README.md` cập nhật | THIẾU (còn mô tả pipeline Python cũ và chỉ nhắc migration 0001; thực tế cần chạy 0001–0006) |

### M10. Bảo mật và tuân thủ
Điểm cần xử lý (chi tiết ưu tiên ở mục 10): bucket `exam-images` công khai và policy insert cho mọi user đã đăng nhập ghi vào mọi đường dẫn; endpoint học sinh không xác thực ngoài UUID; không rate limit; `GET /api/cron/keepalive` mở nếu thiếu `CRON_SECRET`; kiểu `SourceBranch` trong TypeScript thiếu `NO_MATH_DETECTED` (DB đã cho phép); nên cân nhắc nội dung đề công khai/bản quyền khi lưu trữ.

### M11. Cấu trúc mã nguồn quan trọng
- `src/lib/extraction/`: `docxExtract.ts` (đọc docx, nhận diện nhánh OMML/WMF), `omml2latex.ts`, `llmClient.ts` (~1070 dòng: Gemini, prompt, retry, RECITATION, ghép đáp án), `normalize.ts` (chuẩn hóa đầu ra, tách PHẦN, sửa `\vec`...), `pdfRender.ts` (mupdf render PNG).
- `src/lib/conversion/cloudconvert.ts` (docx→PDF), `src/lib/scoring/index.ts`, `src/lib/shuffle.ts`, `src/lib/sessionBreakdown.ts`, `src/types/exam.ts`.
- `src/components/`: `QuestionEditor`, `ExamPreviewModal`, `ExamStatusControls`, `ResizableSplitView`, `OriginalFileViewer`, `RoomCharts`, `Latex` (KaTeX, bảng Markdown, `white-space: pre-line`, marker `[CT?N]`), `DeleteExamButton`, `CreateRoomForm`, `RoomActiveToggle`, `ExportCsvButton`.
- `supabase/migrations/0001..0006`. `pipeline/` (Python) là bản cũ, **không còn dùng**.

### M12. Cơ sở dữ liệu (tóm tắt, nguồn: migrations)
| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `teachers` | `id` (→ auth.users, cascade), `full_name` | RLS: chỉ xem/sửa hồ sơ của mình |
| `exams` | `teacher_id`, `title`, `subject`, `duration_minutes`, `status` (draft/reviewing/ready/archived), `source_branch`, `settings` jsonb, `original_file_url/ext`, `original_preview_url` | RLS: chủ đề thi |
| `questions` | `exam_id`, `order_index`, `type`, `content_latex`, `part_label`, `image_urls` jsonb, `options` jsonb, `sub_statements` jsonb, `correct_answer`, `short_answer_normalized`, `score_rule`, `max_score`, `needs_review`, `raw_ocr_notes` | RLS: qua chủ đề thi |
| `exam_rooms` | `exam_id`, `code` UNIQUE, `opens_at`, `closes_at`, `is_active`, `require_fullscreen`, `max_attempts`, `violation_kick_limit` | Học sinh truy cập qua API dùng service role |
| `exam_sessions` | `room_id`, `student_name`, `student_code`, `question_order`, `option_order`, `status` (in_progress/submitted/graded), `started_at`, `submitted_at`, `total_score`, `violation_count`, `kicked_at` | Chỉ giáo viên đọc (RLS), ghi qua service role |
| `student_answers` | `session_id`, `question_id`, `answer` jsonb, `is_correct`, `score`; UNIQUE(session, question) | |
| `exam_violations` | `session_id`, `type`, `occurred_at`, `meta` | Đã bật Realtime |
| `llm_call_slots` | `expires_at` | Chỉ service role (migration 0006) |
| Storage `exam-images` | bucket công khai | Policy: ai cũng đọc; user đăng nhập được ghi mọi đường dẫn; không có policy xóa |

Dạng `student_answers.answer`: `{selected}` (trắc nghiệm), `{statements:{a:true,...}}` (đúng/sai), `{text}` (điền đáp án).

---

## 4. Hiện trạng pipeline số hóa đề và nhật ký lỗi

### 4.1 Luồng hiện tại (`POST /api/exams/extract-upload`)
1. Tải 2 file từ Storage về bằng service role.
2. Docx MathType cũ → từ chối 400.
3. Song song hai việc (Promise.all):
   - **Đề**: docx → `extractDocx` + `structureExamText` (1 lệnh gọi Gemini text); PDF/ảnh → render từng trang 200dpi → mỗi trang 1 lệnh gọi Gemini vision với prompt dài (schema câu hỏi + khung hình `bbox_1000`).
   - **Đáp án**: docx → text; PDF → từng trang vision; ảnh → 1 lệnh gọi.
4. Khi trang bị `RECITATION`: đọc lại ở **chế độ chèn ký hiệu `¦`** (rồi xóa) → nếu vẫn lỗi thì **tách đôi trang** → nếu vẫn lỗi thì **Qwen (OpenRouter free)** → nếu vẫn lỗi thì bỏ trang và cảnh báo.
5. `normalizeExtractedExam`, rồi `mergeAnswerKeyIntoQuestions` (file đáp án quyết định loại câu nếu hình dạng không mâu thuẫn).
6. Ghi DB không transaction, upload ảnh, xóa file tạm.

### 4.2 Điểm yếu cốt lõi của thiết kế hiện tại
- **Đọc cả trang trong một lệnh gọi** chia nhỏ ngân sách chi tiết ảnh cho ~5 câu → mất ký hiệu nhỏ (dấu `|`) mà **không báo lỗi** (xem mục 5.2).
- Tọa độ hình và gán hình do **cùng một lệnh gọi đoán**, dễ gán nhầm.
- Câu lem trang dựa vào việc AI tự gắn dấu `[TIẾP TRANG TRƯỚC]`.
- Loại câu, tiêu đề PHẦN, nhãn "Câu N" đều do AI trộn trong cùng một chuỗi → lỗi tách chuỗi (đã gặp thật).
- Không có kiểm chứng độc lập, không có telemetry chi phí, không có tiến độ.

### 4.3 Nhật ký lỗi đã gặp và đã xử lý (để Agent không lặp lại)
| Lỗi | Nguyên nhân gốc | Trạng thái |
|---|---|---|
| `\vec{v}` hiện thành chữ "y" | Glyph mũi tên `\vec` của KaTeX đè chữ ngắn | Đã sửa: ghi đè thành `\overrightarrow{` |
| Phương án lặp lại trong nội dung câu | AI chép luôn a/b/c/d vào `content_latex` | Đã sửa: prompt + `stripDuplicatedChoices` |
| `content_latex` rỗng sau tiêu đề PHẦN | Tách PHẦN chạy trước khi đổi `\n` literal thành xuống dòng thật | Đã sửa thứ tự |
| Gạch đầu dòng `+`/`-` dính một dòng | Thiếu `\n` và HTML mặc định nuốt `\n` | Đã sửa: chèn `\n` + `white-space: pre-line` |
| Upload thật lỗi "Unexpected token 'R'" | Body > 4.5MB, Vercel trả text 413 | Đã sửa: upload thẳng Storage |
| Upload thật lỗi "Unexpected token 'A'" | Vượt `maxDuration`, Vercel trả HTML | Đã sửa: xử lý song song, frontend parse an toàn |
| Tạo exam lỗi `violates check constraint` | CHECK `source_branch` thiếu `NO_MATH_DETECTED` | Đã sửa bằng migration 0005 |
| Docx MathType cũ cho công thức rỗng/rác | WMF, 2 lần tự giải mã đều thất bại trên Vercel; CloudConvert hết credit | Đã chặn từ đầu, yêu cầu PDF |
| 429 và 500 khi test dồn | Hạn mức theo phút của Gemini free | Đã sửa: chờ đúng `retryDelay` |
| Câu điền đáp án bị gán `multiple_choice` không có phương án | AI suy loại câu sai (xảy ra ở chế độ chống RECITATION/tách đôi) | Đã sửa: luật theo hình dạng + theo file đáp án |
| Câu đúng/sai lem trang chỉ còn 3/4 ý | Ghép trang ghi đè mảng thay vì gộp | Đã sửa: gộp theo key |
| **Tiêu đề PHẦN nuốt cả câu hỏi** (câu 17: nội dung rỗng, công thức hiện `$...$`) | Regex tách PHẦN chạy tới hết chuỗi khi không có xuống dòng | **Đã sửa và deploy (commit `7f1ee6a`), có 7 test đơn vị; CHƯA kiểm lại bằng upload thật** |
| **Mất dấu `\|` trong `\int_a^b \|f(x)\| dx` (câu 2 phương án A)** | AI đọc cả trang bỏ ký hiệu nhỏ | **CHƯA SỬA trong pipeline** — thí nghiệm cho thấy đọc từng câu sửa được (mục 5.2) |
| Đáp án câu 8 và 19 không tự điền được | Đọc file đáp án dạng lời giải 14 trang không ổn định | Chưa sửa; hướng: upload ảnh bảng đáp án (E11) |
| Bảng biến thiên "tự vẽ sai" | Thực ra là ảnh crop thật bị gán nhầm/cắt sai, không có code tự vẽ | Chưa sửa; hướng: coi bảng biến thiên là hình, crop theo từng câu |

---

## 5. Dữ liệu thực nghiệm đã có (bằng chứng cho kế hoạch)

Dữ liệu thử: đề minh họa THPT 2025 môn Toán (5 trang, 22 câu) và file đáp án (14 trang lời giải). Đây là **đề công khai bị đăng khắp nơi** nên rất hay dính RECITATION; đề giáo viên tự soạn gần như không dính.

### 5.1 RECITATION [ĐÃ ĐO]
| Thí nghiệm | Kết quả |
|---|---|
| Prompt thường, trang 3 và 4, `gemini-3.5-flash-lite` | Bị chặn 4/4 lần |
| Đổi `temperature` lên 1.0 | Vẫn bị chặn |
| Đổi sang các model khác (`2.5-flash`, `3-flash-preview`, `3.1-flash-lite`, `3.5-flash-lite`, `gemma-4-31b-it`, `gemma-4-26b`...) | **Mọi model trả lời được đều bị chặn**; vài model khác lỗi 503/429/404 nên không kết luận được |
| JSON mode so với văn bản Markdown thường | Cả hai đều bị chặn |
| Tách đôi trang (trên/dưới, chồng lấn 10%) | Lần đầu cả hai nửa qua; các lần sau **có nửa vẫn bị chặn** (không ổn định) |
| **Chèn ký hiệu `¦` giữa các cụm ~3 từ rồi xóa sau** | **Trả `STOP` ở mọi lần thử** (có vài lần JSON sai hình dạng — trả mảng thay vì `{questions,...}` — đã chuẩn hóa trong code). End-to-end trên production: **22/22 câu ở cả 3 lần chạy liên tiếp, không sót ký hiệu** (lần đầu còn lỗi loại câu, đã sửa sau đó) |
| Citation metadata của Gemini khi trả lời được | Nêu nguồn `scribd.com` và `arxiv.org` → xác nhận nội dung đã bị đăng công khai |

Nhận định: bộ lọc so khớp chuỗi chữ liền mạch của output; không thể tắt qua `safetySettings`; hành vi **không cố định** theo thời gian/phiên.

### 5.2 Độ trung thực ký hiệu [ĐÃ ĐO] (câu 2, phương án A phải là `π∫|f(x)|dx`)
| Cách đọc | Có dấu `\|` |
|---|---|
| Cả trang 200dpi, prompt thường | **Mất** (2/2) |
| Cả trang 200dpi, prompt nhắc "giữ nguyên dấu giá trị tuyệt đối" | **Mất** (2/2) |
| Cả trang 300dpi + prompt nhắc | **Mất** (2/2) |
| Cả trang 300dpi + `mediaResolution=HIGH` | **Mất** (2/2) |
| **Cắt riêng khối Câu 2 (300dpi)** | **Đúng** (2/2) |
| **Cắt riêng khối Câu 2, phóng to 2x** | **Đúng** (2/2) |

Giải thích: số token thị giác của một ảnh gần như cố định ~1.090–1.165 bất kể kích thước (trang đầy đủ 1.165, ảnh cắt 1.117, ảnh 1×1 pixel 1.089). Đọc cả trang chia ngân sách đó cho cả trang; đọc từng câu dồn hết cho một câu.

### 5.3 Toạ độ [ĐÃ ĐO]
- Gemini trả `box_2d` theo định dạng riêng **`[ymin, xmin, ymax, xmax]`, thang 0–1000** khi không bị ép định dạng; khi prompt yêu cầu `bbox_1000 [x0,y0,x1,y1]` thì model làm theo prompt (đang dùng ổn trong production). **Luôn xác minh thứ tự trục.**
- Lệnh gọi lấy khung Câu 2 cắt ra ảnh 2223×439 (ở 300dpi) bao đủ khối câu.

### 5.4 Lớp chữ của PDF [ĐÃ ĐO]
| File | Kết quả |
|---|---|
| `De 1-De-Goc minh hoa.pdf` (xuất từ Word) | 5 trang, **có lớp chữ** (mỗi trang 17–302 dòng). Tìm được **đủ 22 nhãn `Câu N` liên tục**: trang 1 (câu 1–6), 2 (7–14), 3 (15–16), 4 (17–21), 5 (22), kèm toạ độ y của từng nhãn (đơn vị pt, trang 595×842) |
| `De 1-Giai (1).pdf` (xuất từ Word) | 14 trang, có lớp chữ, tìm được nhãn câu 4–22 (bảng đáp án ở trang 1) |
| Chất lượng chữ trong lớp chữ | Tiếng Việt thường tốt nhưng **công thức bị vỡ** (ví dụ `mặt phẳng ( )` mất nội dung công thức) → không đủ để thay AI đọc công thức |

Hệ quả: với PDF xuất từ Word, **vị trí từng câu lấy chính xác bằng code, miễn phí, không cần AI**. PDF dạng ảnh quét/chụp không có lớp chữ → cần phương án lưới tọa độ (mục 7).

### 5.5 Nhà cung cấp thay thế [ĐÃ ĐO / TRA CỨU]
| Nhà cung cấp | Kết quả |
|---|---|
| OpenRouter `:free` (Qwen3.8-27B, Gemma-4-31B) | 429 do pool dùng chung quá tải (cả hai) |
| OpenRouter `inkling:free` | 403, chỉ dùng được trong công cụ agent |
| OpenRouter `nemotron-3-nano-omni:free` | 200 nhưng **không nhận ảnh** (`prompt_tokens=190`, trả `questions: []`) |
| OpenRouter Qwen2.5-VL-72B | Không còn miễn phí |
| Mistral | Gói Free chỉ thử trong Studio, **API key bị khóa** (cần Pro $11,99/tháng) |
| xAI Grok API | Không còn gói miễn phí từ 05/2025 |
| GitHub Models (GPT-4.1) | Free nhưng 50 request/ngày, tối đa ~8K token input mỗi request (tra cứu, chưa thử) |

### 5.6 Hiệu năng pipeline [ĐÃ ĐO]
- Docx MathType cũ qua CloudConvert tuần tự: 195s; song song đề + đáp án: 41s.
- PDF 5 trang + đáp án PDF 14 trang trên production: 72–108s (22/22 câu).
- Các kết quả chất lượng ở mục 4.3 (đáp án thiếu câu 8, 19) lấy từ cùng lần chạy.

### 5.7 Chưa đo (phải đo trong mục 9)
Ảnh bảng đáp án (screenshot) có đọc đúng cả 22 đáp án không (E11); đọc từng câu trên toàn bộ 22 câu (E3); lưới tọa độ (E2); đo chi phí thật; thời gian khi chạy 22 lệnh gọi song song.

---

## 6. Kế hoạch chất lượng mới: Phân đoạn → Đọc → Kiểm chứng → Duyệt

Nguyên tắc thiết kế:
1. **Mọi thứ có thể làm bằng code thì không giao cho AI** (vị trí câu, nhãn "Câu N", tiêu đề PHẦN, ghép trang, loại câu theo đáp án, kiểm tra cú pháp).
2. **AI chỉ đọc một câu một lần** trên ảnh cắt sát (dồn hết chi tiết ảnh vào một câu).
3. **Không tin một lần đọc**: đọc hai lần độc lập + kiểm chứng.
4. **Luôn giữ ảnh gốc của từng câu** để giáo viên đối chiếu và để dùng làm phương án cuối.
5. Toàn bộ hệ thống phải **đo được** (token, tiền, thời gian, cờ) và **chạy được theo từng bước nhỏ** (không một request dài).

### 6.1 Sơ đồ tổng thể

```
Upload (đề + đáp án) ──► Giai đoạn 0: Phân loại nguồn
                              │
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                          ▼
   DOCX hiện đại      PDF có lớp chữ              PDF ảnh quét / ảnh chụp
   (OMML → LaTeX      (tìm nhãn "Câu N"            (lưới tọa độ + AI lấy khung
   bằng code)          bằng code)                   + ink-snap)
        │                     │                          │
        └─────────────┬───────┴──────────────────────────┘
                      ▼
        Giai đoạn 2: Cắt từng câu (ghép dọc nếu lem trang) → lưu ảnh crop
                      ▼
        Giai đoạn 3: ĐỌC lần A (rẻ)  ║  ĐỌC lần B (model mạnh hơn, độc lập)
                      ▼
        Giai đoạn 4: KIỂM CHỨNG
          - luật code: KaTeX parse, đủ A–D / a–d, số câu liên tục, loại câu khớp đáp án
          - so khớp A với B (khác nhau → cờ)
          - AI kiểm tra lại ảnh gốc với bản đã đọc (nhắm ký hiệu hay mất)
                      ▼
        Giai đoạn 5: Trang duyệt: ảnh gốc cạnh bản số hóa, câu bị cờ xếp trước,
                      lý do cờ cụ thể, xác nhận nhanh
```

### 6.2 Giai đoạn 0: Phân loại nguồn (code, miễn phí)
- `.docx`: `detectDocxBranch` (đã có). OMML hoặc không công thức → nhánh docx; WMF cũ → hướng dẫn xuất PDF.
- `.pdf`: dùng `mupdf` `toStructuredText` thăm dò lớp chữ: tổng số ký tự, số nhãn `Câu N`. Có lớp chữ và có nhãn → **nhánh PDF-văn bản**; ngược lại → **nhánh PDF-ảnh**.
- Ảnh: nhánh PDF-ảnh.
- Ghi `source_branch` và độ tin cậy phân đoạn vào `extraction_jobs`.

### 6.3 Giai đoạn 1: Phân đoạn (xác định khối từng câu)
**Phương án A: lớp chữ PDF** (ưu tiên, miễn phí, chính xác) — thiết kế chi tiết ở mục 7.2.
**Phương án B: lưới tọa độ + AI** (cho ảnh/scan) — mục 7.1.
**Phương án C (so sánh trong thí nghiệm)**: AI trả `box_2d` thuần không lưới (đường cơ sở hiện tại).
Mọi phương án đều kết thúc bằng **kiểm tra và hiệu chỉnh bằng code** ("ink-snap", mục 7.1 quy tắc 7), rồi **quy tắc kiểm tra**: nhãn "Câu N" liên tục từ 1 đến N, các khối không chồng lấn quá ngưỡng, tổng số khối khớp số mục trong file đáp án.

### 6.4 Giai đoạn 2: Cắt từng câu
- Cắt từ **ảnh sạch gốc** (không bao giờ cắt từ ảnh có lưới), độ phân giải 250–300dpi, lề an toàn 1,5%.
- **Câu lem trang**: cắt phần cuối trang N và phần đầu trang N+1, **ghép dọc thành một ảnh** (nền trắng, khe 20px) rồi đọc như một câu. Thay thế hoàn toàn cơ chế `[TIẾP TRANG TRƯỚC]` hiện tại.
- Lưu mọi ảnh crop vào Storage (`<examId>/src/q<idx>.png`) và ghi `questions.source_crop_url`.
- Tiêu đề PHẦN lấy từ bước phân đoạn (không để AI trộn vào nội dung câu).

### 6.5 Giai đoạn 3: Đọc từng câu
- **Lần A**: `gemini-3.5-flash-lite`, prompt một câu (mục 6.8), JSON một đối tượng.
- **Lần B (độc lập)**: model khác và/hoặc ảnh khác (phóng to 2x hoặc lề khác) để lỗi không tương quan: `gemini-3.8-flash` (thí nghiệm E4 chọn model).
- **RECITATION**: nếu một lần đọc bị chặn → thử lại ở **chế độ chèn ký hiệu `¦`** (đã được chứng minh) → nếu vẫn chặn thì dùng ảnh phóng to hoặc tách đôi khối câu → nếu vẫn chặn thì tạo **câu giữ chỗ**: `content_latex` ghi "Không đọc được tự động", đính kèm **ảnh crop** làm nội dung, gắn cờ đỏ.
- Các lệnh gọi chạy song song (4–6 luồng) qua hàng đợi `llm_call_slots` hiện có.
- Hình vẽ trong câu: yêu cầu model trả khung hình **theo hệ toạ độ của ảnh crop** (hoặc dùng lưới trên ảnh crop để chính xác hơn, E8). Hình thuộc câu nào được xác định **tự nhiên theo ảnh crop** → hết lỗi gán nhầm hình giữa các câu.
- Quy ước nội dung: bảng số liệu thường → bảng Markdown; **bảng biến thiên và đồ thị → luôn coi là hình** (không chép thành chữ).

### 6.6 Giai đoạn 4: Kiểm chứng (nhiều lớp)
1. **Luật bằng code** (miễn phí): mỗi công thức `$...$` render thử bằng KaTeX (`throwOnError: true`), lỗi → đọc lại lần C; trắc nghiệm phải có đúng 4 phương án A–D; đúng/sai phải đủ ý a–d (số ý phải khớp file đáp án); số câu phải liên tục; `type` phải khớp **loại đáp án trong file đáp án**; không còn ký hiệu `¦`, `[IMAGE:...]`, "PHẦN" nằm trong nội dung câu.
2. **So khớp A và B**: chuẩn hóa (bỏ khoảng trắng thừa, `\,`, `\dfrac`≈`\frac`...) rồi so từng trường (nội dung, từng phương án). Khác nhau → cờ "Hai lần đọc khác nhau" kèm chỗ khác. Có thể cho lần C phân xử (ảnh gốc + hai bản).
3. **AI kiểm tra (verifier)**: gửi ảnh crop + bản đã đọc; hỏi "liệt kê MỌI chỗ bản chép khác ảnh: ký hiệu bị thiếu/thừa (đặc biệt `|`, dấu `−`, số mũ, chỉ số, véc-tơ, dấu ngoặc), số/chữ cái sai". Trả JSON danh sách khác biệt. Mục tiêu: bắt lỗi mất ký hiệu. Bắt buộc đo tỉ lệ bắt lỗi (E7).
4. **Đối chiếu đáp án**: đáp án đọc từ file đáp án; câu thiếu đáp án, câu đúng/sai thiếu ý, đếm sai → cờ (đã có một phần).
5. **Điểm tin cậy**: tổng hợp các cờ thành điểm; thứ tự duyệt = giảm dần theo rủi ro.

### 6.7 Giai đoạn 5: Trang duyệt (chiến lược "soát nhanh có định hướng")
- Mỗi câu: bên trái bản số hóa chỉnh sửa được, bên phải **ảnh crop gốc**, trên cùng các **huy hiệu cờ** có lý do cụ thể.
- Câu bị cờ xếp trước; câu không cờ gom nhóm "Qua cả 4 lớp kiểm tra" cho giáo viên liếc nhanh và "Xác nhận cả nhóm".
- Phím tắt: mũi tên chuyển câu, Enter xác nhận, E sửa, I chuyển sang hiển thị "câu là ảnh gốc" cho câu không thể số hóa chính xác.
- Đo thời gian soát thực tế (E14); mục tiêu: dưới 5 phút cho đề 22 câu.
- **Phương án cuối cho câu khó**: hiển thị ảnh gốc làm phần đề bài (học sinh thấy đúng như bản in), phương án và đáp án vẫn là dữ liệu nên vẫn xáo/chấm được.

### 6.8 Prompt một câu (bản nháp để Agent hoàn thiện, **thí nghiệm E3/E5 sẽ chốt**)
```
Bạn là trợ lý số hóa đề thi tiếng Việt. Ảnh đính kèm là ĐÚNG MỘT câu hỏi (có thể gồm 2 nửa ghép dọc
nếu câu bị cắt ngang trang). Trả về DUY NHẤT một JSON:
{ "type": "multiple_choice"|"true_false_group"|"short_answer",
  "content_latex": "...",
  "options": [{"key":"A","text_latex":"..."}],
  "sub_statements": [{"key":"a","text_latex":"..."}],
  "figure_boxes": [{"id":"fig1","bbox_1000":[x0,y0,x1,y1]}],
  "raw_ocr_notes": null }
Quy tắc:
- content_latex chỉ chứa đề dẫn; KHÔNG chép nhãn "Câu N." đầu câu; KHÔNG chép "PHẦN ..."; KHÔNG chép phương án/ý.
- CHÉP ĐÚNG TỪNG KÝ HIỆU nhìn thấy, KHÔNG tự rút gọn hay "sửa cho hợp lý": giữ dấu giá trị tuyệt đối \left|..\right|,
  dấu ngoặc, số mũ, chỉ số, ≥ ≤, véc-tơ (\overrightarrow{AB}). Phương án nào trông thừa/sai vẫn chép đúng như in.
- Công thức bọc $...$. Bảng số liệu thường dùng bảng Markdown. Bảng BIẾN THIÊN và ĐỒ THỊ là HÌNH → đưa vào figure_boxes.
- figure_boxes: toạ độ theo ẢNH NÀY (gốc trên-trái, thang 0-1000), nới rộng nhẹ; không có hình → [].
Chỉ trả JSON hợp lệ.
```
Chế độ chống RECITATION: thêm quy tắc chèn " ¦ " mỗi ~3 từ (xem `MARKER_RULE` trong `llmClient.ts`), rồi xóa bằng `stripMarkers`.

### 6.9 Kiến trúc chạy: bỏ "một request dài 280s"
Đề xuất **điều phối từ trình duyệt theo bước nhỏ** (hợp Vercel Hobby, có tiến độ, resume được):
1. `POST /api/exams/extract/start`: tạo `extraction_jobs`, thực hiện Giai đoạn 0–1–2 (nhanh, không/ít AI), tạo `extraction_items` (một dòng mỗi câu) và crop. Trả `job_id` và danh sách item.
2. Trình duyệt gọi `POST /api/exams/extract/item` **song song 4–6 item một lúc** (mỗi lệnh dưới 60s: đọc A, đọc B, kiểm chứng cho một câu), cập nhật thanh tiến độ.
3. `POST /api/exams/extract/finish`: ghép đáp án, chạy luật toàn cục, tạo `exams` + `questions` (trong **một transaction RPC**), gắn cờ, chuyển sang trang duyệt.
4. Item lỗi tạm thời (429/503) tự retry; có nút "Thử lại các câu lỗi"; tải lại trang vẫn tiếp tục theo `job_id`.
Phương án thay thế (nếu cần): Supabase Edge Functions/`pg_cron`, hàng đợi trả phí — chỉ dùng nếu bước 2 không đủ.

### 6.10 Thay đổi dữ liệu đề xuất (migration mới)
- `extraction_jobs(id, teacher_id, exam_id null, status, source_branch, file_paths, total_items, done_items, est_cost_vnd, created_at, finished_at)`
- `extraction_items(id, job_id, idx, label, part_label, crop_url, status, attempts, read_a jsonb, read_b jsonb, verifier jsonb, flags jsonb, result jsonb, tokens_in, tokens_out, cost_usd, error)`
- `llm_usage(id, job_id null, item_id null, model, kind, tokens_in, tokens_out, thoughts_tokens, cost_usd, latency_ms, finish_reason, created_at)`
- `questions`: thêm `source_crop_url text`, `extraction_meta jsonb` (cờ, hai bản đọc, điểm tin cậy), `confidence numeric`.
- Cho phép `questions.type` đổi được; thêm các cột còn thiếu ở mục 10.

---

## 7. Thiết kế lưới tọa độ (ý tưởng của chủ dự án) và phân đoạn bằng lớp chữ PDF

### 7.1 Lưới tọa độ để Gemini cắt đúng toạ độ

**Ý tưởng**: thay vì để AI "ước chừng" toạ độ chuẩn hóa từ ảnh trống (dễ lệch), ta **vẽ sẵn thước/lưới toạ độ lên một BẢN SAO của ảnh** và bảo AI đọc toạ độ theo thước. **Yêu cầu của chủ dự án: lưới tuyệt đối không chèn chữ vào vùng nội dung** (để không làm nhiễu OCR và không bị AI nhầm chữ của lưới với chữ của đề).

**Quy tắc thiết kế (bắt buộc)**
1. **Hai ảnh tách biệt**: `P` (ảnh sạch) và `G` (bản sao có lưới). `G` chỉ dùng cho lệnh gọi lấy khung. **Mọi lần cắt, mọi lần đọc nội dung đều dùng `P`.** Nhờ vậy lưới không bao giờ lọt vào nội dung đọc/cắt.
2. **Gutter (lề thước)**: thêm lề trắng quanh `G` (khoảng 4% cạnh dài, tối thiểu 70px, ở cả 4 cạnh). **Mọi chữ số/nhãn chỉ vẽ trong gutter**, không vẽ chữ nào trên vùng nội dung.
3. **Đơn vị**: toạ độ theo **phần nghìn của vùng nội dung** (0–1000 mỗi trục, gốc trên-trái của ảnh gốc, KHÔNG tính gutter). Công thức đổi về pixel của `P`: `px = giá_trị/1000 × kích_thước_P`.
4. **Đường lưới trong vùng nội dung**: chỉ là đường kẻ mảnh, màu đỏ nhạt trong suốt (gợi ý alpha ~0.25–0.35): mỗi 100 đơn vị nét 2px, mỗi 50 đơn vị nét 1px. Không có chữ trên đường. Danh tính từng đường được đọc nhờ **nhãn ở hai đầu đường nằm trong gutter**.
5. **Vẽ chữ số không dùng `<text>`/font** (xem lưu ý Vercel ở mục 2.2): dùng sprite PNG chữ số có sẵn trong repo, hoặc vẽ từng chữ số bằng đường polyline kiểu 7 đoạn trong SVG `<path>`; sau đó `sharp.composite`.
6. **Prompt lấy khung**: nêu rõ có thước đỏ ở lề (đơn vị 0–1000), yêu cầu trả `[ymin, xmin, ymax, xmax]` theo thước, **chỉ trả số và nhãn ngắn**, không chép nội dung câu (cũng giúp né RECITATION).
7. **Hiệu chỉnh bằng code (ink-snap)**: sau khi có khung, chiếu mật độ mực theo hàng/cột trên `P`; dời mỗi cạnh khung tới **dải trắng gần nhất** trong ±N pixel (không cắt ngang dòng chữ), rồi nới lề an toàn. Đây là lớp độc lập với AI.
8. **Tinh chỉnh thô → mịn (tùy chọn, đo trong E2b)**: cắt khung thô nới 5%, vẽ lưới mịn (bước 10) lên bản sao của vùng đó, hỏi lại hai cạnh, rồi ink-snap.

**Các biến thể lưới cần so sánh (thí nghiệm E2)**
| Mã | Mô tả |
|---|---|
| G0 | Không lưới, `box_2d` thuần (đường cơ sở) |
| G1 | Chỉ thước ở lề (vạch + số), không đường trong vùng nội dung |
| G2 | Thước ở lề + đường lưới mờ mỗi 100 |
| G3 | Thước ở lề + đường lưới mờ mỗi 50 (xen kẽ đậm nhạt) |
| G4 | Lưới ô có tên (cột A–T × hàng 1–30), nhãn ở lề, AI trả dải ô thay vì số |
| G5 | G2/G3 + tinh chỉnh thô→mịn trên khung đã cắt |
| G6 | G3 + màu khác nhau theo hàng/cột (giúp phân biệt đường) |

### 7.2 Phân đoạn bằng lớp chữ PDF (phương án A, ưu tiên)
Điều kiện: PDF có lớp chữ (xuất từ Word, in từ trình soạn thảo...). **Đã đo**: file đề mẫu tìm đủ 22 nhãn liên tục (mục 5.4).

Thuật toán đề xuất:
1. Với mỗi trang, lấy `page.toStructuredText()` → JSON dòng + bbox (đơn vị pt).
2. Neo câu hỏi: dòng khớp `^\s*Câu\s+(\d+)\s*[.:]` (chữ C hoa). Neo tiêu đề phần: `^\s*PHẦN\s+[IVXLC\d]+`. Bỏ qua dòng lặp lại ở cùng vị trí mọi trang (số trang, header/footer).
3. Khối câu `i` = từ `y` của neo `i` (trừ lề nhỏ) đến `y` của neo `i+1` (trừ lề). Nếu neo kế tiếp ở trang sau: khối gồm [neo `i` → cuối vùng nội dung trang N] **và** [đầu vùng nội dung trang N+1 → neo `i+1`]; ghép dọc.
4. Cột/bố cục hai cột: phát hiện bằng phân bố `x` của dòng; nếu hai cột thì phân đoạn theo cột. (Thí nghiệm E1 đo trên đề có hai cột.)
5. Kiểm tra: thứ tự số liên tục, không thiếu/thừa; số khối khớp số câu trong file đáp án; nếu vi phạm → hạ xuống phương án B (lưới) và ghi cờ.
6. **Thông tin phụ miễn phí**: tiêu đề phần chính xác; **nội dung chữ thô từ lớp chữ** có thể dùng làm *gợi ý* cho lệnh đọc (E15): chữ tiếng Việt từ lớp chữ gần như chắc chắn đúng, AI chỉ cần sửa công thức dựa trên ảnh.

### 7.3 Chốt chặn chung
Dù dùng phương án nào, sau phân đoạn luôn chạy: ink-snap, kiểm tra không chồng lấn, kiểm tra phủ (không có vùng mực lớn nằm ngoài mọi khối, trừ header/footer), và lưu ảnh crop để duyệt.

---

## 8. Mô hình chi phí và thời gian

### 8.1 Giá đã tra cứu (trang giá Gemini API, 2026-10-02)
| Model | Input / 1M token | Output / 1M token | Ghi chú |
|---|---|---|---|
| `gemini-3.5-flash-lite` | $0,30 | $2,50 | đang dùng |
| `gemini-3.1-flash-lite` | $0,25 | $1,50 | rẻ hơn |
| `gemini-3.8-flash` / `3.7-flash` / `3.6-flash` | $0,75 | $3,75 | đến 31/12/2026; từ 01/01/2027 là $1,50 / $7,50 |
| `gemini-3.5-flash` | $1,50 | $9,00 | đắt, hay 503 khi test |
| Gói free | miễn phí, "không giới hạn token" nhưng giới hạn tốc độ theo phút | | |

Tỉ giá giả định: 25.500đ/USD. Token thị giác mỗi ảnh ≈ 1.100 (đã đo). Token "suy nghĩ" của model flash có thể làm đầu ra tăng — phải đo `thoughtsTokenCount`.

### 8.2 Ước tính cho đề 6 trang, 22 câu [ƯỚC TÍNH — phải đo lại]
| Hạng mục | Số lệnh gọi | Token vào / ra mỗi lệnh | Chi phí |
|---|---|---|---|
| Phân đoạn bằng lớp chữ PDF | 0 | | 0đ |
| Phân đoạn bằng lưới (khi scan): 6 trang | 6 | ~1.900 / 400 | ~250đ |
| Đọc lần A (`3.5-flash-lite`) | 22 | ~2.000 / 500 | ~1.040đ |
| Đọc lần B (`3.8-flash`) | 22 | ~2.000 / 500 | ~1.900đ |
| Verifier (`3.5-flash-lite`) | 22 | ~2.600 / 150 | ~650đ |
| Đáp án (1 ảnh bảng) hoặc nhiều trang | 1–14 | | 50–700đ |
| **Tổng điển hình** | **~70** | | **~3.900–4.800đ** |
| **Biên an toàn ×2** (token suy nghĩ, retry, câu đọc lại) | | | **~8.000–9.600đ (< 10.000đ)** |

Quy tắc kiểm soát: đặt **ngân sách mỗi đề** (ví dụ 8.000đ). Vượt ngưỡng dự báo thì giảm cấp theo thứ tự: bỏ verifier → bỏ lần B → chỉ đọc A + luật code, đồng thời hiển thị cảnh báo "độ tin cậy thấp, cần soát nhiều hơn". Đang dùng gói free thì chi phí thực là 0đ nhưng bị giới hạn tốc độ; báo cáo phải ghi cả "chi phí nếu trả phí".

### 8.3 Thời gian [ƯỚC TÍNH]
| Bước | Thời gian |
|---|---|
| Upload, render, phân đoạn, cắt | 10–25s |
| 22 câu × (A rồi B rồi verifier ≈ 15–30s/câu), song song 4–6 luồng | 1,5–3 phút |
| Ghép đáp án, ghi DB | 5–15s |
| **Tổng** | **~2–4 phút**, trần cứng 10 phút |

Khi gặp 429, thời gian chờ theo `retryDelay` có thể cộng thêm 1–2 phút (đã đo 107s ở lần chạy hiện tại có retry).

### 8.4 Telemetry bắt buộc
Mỗi lệnh gọi LLM ghi `llm_usage` từ `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`), model, độ trễ, `finishReason`. Trang quản trị và email báo cáo mỗi đề: **số lệnh gọi, token, đơn giá, tổng đồng**. Không có số này thì không được kết luận "dưới 10.000đ".

---

## 9. Bộ thí nghiệm (E1–E16)

### 9.1 Dữ liệu vàng (làm trước, mọi thí nghiệm dùng chung)
- Gói đề mẫu: `De 1-De-Goc minh hoa.pdf` (5 trang), `.docx` cùng đề (MathType cũ), `De 1-Giai (1).pdf` và `.docx`, `De 1-Giai.docx`, và **ảnh bảng đáp án** (ảnh chụp màn hình giáo viên gửi, có 22 đáp án đúng: 1–12 `B D A C B A B A D C D C`; 13–16 `ĐSĐĐ ĐĐSS ĐSĐS ĐSĐĐ`; 17–22 `4,9 43 3 3200 333 0,08`). Sao chép vào `fixtures/` trong repo để không phụ thuộc thư mục Downloads (các file gốc nằm ở `C:\Users\Admin\Downloads\`).
- **Gán nhãn thủ công (vàng)**: với mỗi câu: khung chuẩn (người vẽ), JSON đúng (nội dung, phương án, ý, loại, đáp án), danh sách hình và khung. Thêm **tối thiểu 3 đề khác loại**: (1) đề Lý/Hóa nhiều hình và bảng; (2) PDF ảnh quét/chụp điện thoại; (3) đề có bảng biến thiên, véc-tơ, tích phân, hệ phương trình, ma trận. Đề phải đa dạng bố cục (một cột/hai cột).
- **Bộ kiểm tra ký hiệu nhỏ**: danh sách ~40 biểu thức dễ mất ký hiệu (`|f(x)|`, `\overrightarrow{AB}`, `\vec`, `x^{-1}`, `a_{n+1}`, `\geq`, `\left[ \right)`, `\sqrt[3]{}`, phân số lồng nhau, dấu trừ vs gạch ngang) cắt từ đề thật.
- **Chỉ số**: (a) *khớp câu* = nội dung sau chuẩn hóa trùng bản vàng; (b) *CER* trên chuỗi LaTeX chuẩn hóa; (c) *IoU* khung; (d) *tỉ lệ lỗi im lặng* = lỗi nội dung mà không có cờ; (e) *precision/recall của cờ*; (f) chi phí đồng/đề và giây/đề.
- Mỗi cấu hình chạy ≥ 3 lần để đo độ ổn định (kết quả Gemini không cố định).

### 9.2 Danh sách thí nghiệm
| ID | Giả thuyết | Cách làm | Chỉ số / tiêu chí đạt | Chi phí ước |
|---|---|---|---|---|
| **E1** | Lớp chữ PDF cho phân đoạn chính xác hơn mọi phương án AI | Chạy thuật toán 7.2 trên toàn bộ PDF xuất từ Word (một và hai cột, có header/footer, câu lem trang) | IoU ≥ 0.95 với khung vàng, 100% nhãn đủ, 0 lỗi thứ tự | 0đ |
| **E2** | Lưới tọa độ cho khung chính xác hơn `box_2d` thuần | So G0–G6 (mục 7.1) trên 6+ trang scan/ảnh, 3 lần mỗi cấu hình | IoU trung bình, % khung cắt mất dòng, số lệnh gọi; chọn phương án có IoU cao nhất và ổn định nhất | ~10.000đ |
| **E2b** | Tinh chỉnh thô→mịn cải thiện hai cạnh | G5 so với G3 | Sai số cạnh (px) giảm ≥ 30% | ~3.000đ |
| **E2c** | Ink-snap (hiệu chỉnh mực) giảm cắt mất dòng | Có/không ink-snap trên khung E2 | % khung cắt ngang dòng chữ = 0 | 0đ |
| **E3** | Đọc từng câu giữ ký hiệu tốt hơn đọc cả trang | 22 câu: cả trang (hiện tại) so với crop 200/250/300dpi so với crop phóng 2x; bộ kiểm tra ký hiệu nhỏ | Tỉ lệ ký hiệu giữ đúng; mục tiêu ≥ 99% | ~5.000đ |
| **E4** | Model mạnh hơn đọc đúng hơn, đáng giá tiền | Cùng crop với `3.5-flash-lite`, `3.1-flash-lite`, `3.8-flash`, `3.7-flash`, `3.5-flash` (và Gemma nếu truy cập được) | Khớp câu, CER, đồng/đề, ổn định; chọn cặp A/B tối ưu | ~15.000đ |
| **E5** | Chế độ chèn `¦` không làm hỏng độ chính xác, chỉ thử khi bị chặn | Đo tỉ lệ vượt RECITATION và CER so với đọc thường trên các câu đọc được; thử thêm biến thể (mỗi 2/3/5 từ, ký hiệu khác, tách đôi khối câu) | Vượt chặn ≥ 95%, CER tăng ≤ 0.5% | ~5.000đ |
| **E6** | Hai lần đọc bất đồng là tín hiệu lỗi tốt | Gieo lỗi có chủ đích vào bản vàng + đo trên lỗi tự nhiên; so khớp A/B | Recall của cờ ≥ 90% với lỗi thật, precision ≥ 50% | ~3.000đ |
| **E7** | Verifier bắt được lỗi mất ký hiệu | Đưa bản có lỗi gieo (xóa `\|`, đổi chữ số, bỏ số mũ) cho verifier kèm ảnh crop; thử vài prompt | Recall ≥ 90%, báo nhầm ≤ 10% | ~3.000đ |
| **E8** | Lưới trên ảnh crop cho khung hình chính xác hơn; bảng biến thiên nên là hình | Hình trong từng câu: prompt thuần so với lưới mịn; đo IoU và độ sạch (không cắt nhãn đỉnh) | IoU ≥ 0.9; 0 hình bị gán nhầm câu | ~4.000đ |
| **E9** | Ghép dọc hai mảnh câu lem trang cho kết quả đúng hơn cơ chế `[TIẾP TRANG TRƯỚC]` | Các câu lem trang trong 3 đề (vd câu 15–16 đề mẫu) | 100% đủ ý/phương án, 0 câu cụt | ~1.000đ |
| **E10** | DPI và `mediaResolution` ảnh hưởng ra sao ở mức crop | 150/200/250/300dpi, có/không `MEDIA_RESOLUTION_HIGH` trên bộ ký hiệu nhỏ | Chọn cấu hình rẻ nhất vẫn đạt E3 | ~3.000đ |
| **E11** | Ảnh bảng đáp án đọc đúng và rẻ hơn file lời giải | So: ảnh bảng, PDF lời giải 14 trang, docx; đo 22/22, đúng/sai `ĐSĐĐ`, số có dấu phẩy | 22/22 đúng ở cả 3 lần; chi phí ≤ 1/10 so với lời giải | ~1.000đ |
| **E12** | Ngân sách và thời gian khi chạy đủ pipeline | Chạy 3 đề đủ 6 trang trên production, đo `usageMetadata`, thời gian, số 429 | < 10.000đ/đề (có ×2 biên), < 10 phút, 0 lỗi cứng | ~15.000đ |
| **E13** | Nhánh docx OMML giữ chính xác 100% | Hồi quy trên 3 docx OMML (Toán, Lý, Hóa) | CER công thức = 0 | ~1.000đ |
| **E14** | Giao diện duyệt rút ngắn thời gian soát | 3 giáo viên soát đề 22 câu: giao diện cũ so với mới (ảnh crop + cờ) | Thời gian ≤ 5 phút, giáo viên bắt đủ lỗi gieo | 0đ + công người |
| **E15** | Dùng chữ từ lớp chữ PDF làm gợi ý giảm lỗi chữ tiếng Việt/chữ số | Truyền chữ thô + ảnh, yêu cầu sửa công thức; so với chỉ ảnh | CER chữ Việt giảm, không tăng RECITATION | ~3.000đ |
| **E16** | Ảnh chụp điện thoại (nghiêng, bóng, mờ) vẫn đạt | 10 ảnh thực tế; tiền xử lý (xoay phẳng, tăng tương phản) | Khớp câu ≥ 90%, cờ bắt đủ câu hỏng | ~5.000đ |

Tổng chi phí thí nghiệm gần đúng 80.000–100.000đ nếu chạy trả phí; chạy trên gói free thì chỉ tốn thời gian (nhớ giới hạn theo phút, chạy rải ra).

### 9.3 Thứ tự chạy gợi ý
1. Dữ liệu vàng + E1 (không tốn tiền) + E11.
2. E3, E10, E4 (chọn cách đọc và model).
3. E6, E7 (kiểm chứng).
4. E2, E2b, E2c, E8 (lưới) — chỉ cần cho scan/ảnh và hình.
5. E5, E9, E15, E16.
6. Dựng pipeline mới, rồi E12, E13, E14.

Mọi thí nghiệm viết thành script trong `scripts/experiments/` (`.mjs` nếu dùng `mupdf`), ghi kết quả JSON, kèm báo cáo Markdown tóm tắt. Không commit khóa API.

---

## 10. Backlog sản phẩm theo ưu tiên

### P0: sai kết quả hoặc hở bảo mật, làm trước khi thi thật
1. **Chặn theo giờ ở server**: từ chối `/answer` và `/submit` sau `started_at + duration` (cho dung sai vài giây); hiện client giả mạo vẫn làm tiếp.
2. **Chính sách phiên bị đuổi**: hiện đuổi → `submitted` rồi **không bao giờ chấm** (điểm NULL, từng câu điểm 0 trong chi tiết). Chọn: chấm phần đã làm, hoặc đặt 0 có ghi chú — và hiển thị đúng.
3. **Bảo mật phiên học sinh**: cấp token phiên ngẫu nhiên (cookie/header), kiểm tra ở `/answer`, `/submit`, `/violation`, `GET session`; rate limit `/join`, `/answer`, `/violation`.
4. **Đếm vi phạm**: `tab_blur` đếm 2 lần mỗi lần chuyển tab; ngưỡng mặc định 1 là đuổi ngay lần đầu. Cần gộp sự kiện, thời gian chờ (grace), và cập nhật đếm nguyên tử (race).
5. **Storage**: policy insert cho mọi user đăng nhập ghi bất kỳ đường dẫn; ràng buộc theo tiền tố `auth.uid()`, bucket tạm riêng và riêng tư; hạn chế `tmp-uploads`.
6. **Transaction**: tạo exam + câu hỏi, xác nhận đề (gỡ cờ + `ready`) phải nguyên tử (RPC).
7. **Kiểm tra `status=ready` khi tạo phòng và khi `join`**.
8. **Giới hạn số lần thi** dựa danh tính yếu (tên/SBD): cân nhắc mã học sinh do giáo viên phát.

### P1: chức năng thiếu quan trọng
9. Pipeline mới (mục 6) với telemetry chi phí, tiến độ và resume.
10. Trang duyệt có ảnh crop + cờ; sửa `part_label`, `type`, thứ tự, thêm/xóa phương án, câu, ảnh; tạo câu thủ công.
11. UI cho `opens_at`/`closes_at`, sửa phòng, nhân bản phòng; UI cho `settings` (xáo câu/phương án, hiện đáp án sau thi, bật/tắt chống gian lận mà hook thực sự đọc).
12. Vòng đời đề: `draft`, `archived`, bỏ xác nhận; xóa đề phải xóa file Storage.
13. Công tắc ẩn/hiện đáp án trên trang kết quả của học sinh.
14. Chấm điểm điền đáp án: dung sai số, nhiều đáp án chấp nhận, ký hiệu dấu phẩy/chấm, đơn vị; đúng/sai không cố định 4 ý.
15. UI giám sát thời gian thực (bảng đã bật Realtime).
16. Lưu lại và hiển thị tiến độ làm bài khi mất mạng (hàng đợi retry cục bộ).

### P2: chất lượng và trải nghiệm
17. Kiểm thử tự động: đơn vị (`scoring`, `shuffle`, `normalize`, `mergeAnswerKey`, `extractPartLabel`), tích hợp (script tạo user tạm + cookie, xem phụ lục), CI.
18. Cmd (macOS), `copy`/`paste` thật, `window_resize`.
19. Giao diện di động cho học sinh; truy cập người khuyết tật; chế độ tối.
20. Thống kê câu hỏi: độ khó, độ phân biệt, câu nhiều học sinh bỏ trống; xuất Excel/PDF; so sánh phòng.
21. Ngân hàng câu hỏi dùng lại giữa các đề; trộn đề từ nhiều đề; sinh mã đề (nhiều bản xáo) in PDF.
22. Tài liệu: sửa `README.md` (nêu đủ migration 0001–0006, bỏ phần pipeline Python cũ, thêm hướng dẫn thiết lập Gemini billing).

### P3: mở rộng
23. Vai trò (quản trị trường, tổ trưởng), chia sẻ đề giữa giáo viên, thư viện đề.
24. Tích hợp LMS/đăng nhập học sinh, nhập danh sách lớp.
25. Quản lý gói/hạn mức và thanh toán.

### Nợ kỹ thuật cần dọn
- Thêm `NO_MATH_DETECTED` vào kiểu TypeScript `SourceBranch`.
- Comment lỗi thời trong `llmClient.ts` (nhắc "110s", "maxDuration=60s").
- Gỡ/kết thúc thư mục `pipeline/` (Python) hoặc ghi rõ đã bỏ.
- Gộp hai cơ chế đọc (đọc trang / đọc từng câu) sau khi pipeline mới ổn định; xóa nhánh Qwen OpenRouter nếu thí nghiệm xác nhận không dùng được.
- `exams.updated_at` chưa có trigger; `zod` có trong dependency nhưng chưa dùng.

---

## 11. Tiêu chí nghiệm thu (Definition of Done)

**Pipeline số hóa**
- [ ] Trên bộ dữ liệu vàng (≥ 4 đề đa dạng): khớp câu ≥ 97% khi chưa có người soát; lỗi im lặng ≤ 1/50 câu; sau khi soát các câu bị cờ thì 100% đúng.
- [ ] Không còn mất ký hiệu trong bộ kiểm tra ký hiệu nhỏ (≥ 99%).
- [ ] Mọi câu có ảnh crop gốc xem được ở trang duyệt; câu bị cờ có lý do cụ thể.
- [ ] 22 câu đề mẫu: đủ 22/22, loại câu đúng, tiêu đề PHẦN đúng, hình gán đúng câu, đáp án khớp bảng đáp án.
- [ ] Chi phí đo thật bằng `usageMetadata` < 10.000đ/đề 6 trang (kể cả khi tính theo giá trả phí), thời gian < 10 phút, không lỗi cứng trong 20 lần chạy liên tiếp.
- [ ] Có tiến độ hiển thị, resume sau khi tải lại, nút thử lại các câu lỗi.
- [ ] Mọi bước có telemetry (`llm_usage`) và ngân sách giảm cấp.

**Sản phẩm**
- [ ] Toàn bộ mục P0 xong, có test.
- [ ] Mỗi module M1–M10 có bộ test tối thiểu và README cập nhật.
- [ ] Có kịch bản thi thử đầy đủ: một giáo viên tạo đề, 30 học sinh giả lập thi đồng thời, không lỗi và điểm khớp bảng đáp án.

---

## 12. Phụ lục

### 12.1 Quy tắc làm việc cho Agent
1. Đọc `AGENTS.md`, rồi tài liệu Next.js trong `node_modules/next/dist/docs/` trước khi viết code Next.
2. **Không báo "đã sửa" khi chưa kiểm trên production** (chủ dự án rất nhạy cảm điểm này). Mỗi sửa phải có bằng chứng (HTTP, số câu, ảnh chụp) và nêu rõ phần chưa kiểm.
3. Dữ liệu kiểm thử tạo ra phải **dọn sạch** (tài khoản tạm, đề, file Storage).
4. **Không in khóa API/token** ra log hay tin nhắn; chỉ ghi tên biến. Không commit `.env*`.
5. Không thêm tính năng ngoài phạm vi; mọi thay đổi thiết kế đã chốt phải ghi lý do.
6. Với việc tốn phí hoặc rủi ro (bật billing, xóa dữ liệu, chạy migration), hỏi chủ dự án trước.
7. Migration SQL: chủ dự án tự chạy trong Supabase SQL Editor (Agent không có mật khẩu DB). Mã phải **fail-open** nếu migration chưa chạy (đã làm với `llm_call_slots`).

### 12.2 Lưu ý môi trường (Windows, dễ vấp)
- Dùng công cụ `Write` để tạo script có đường dẫn Windows; **heredoc bash làm mất dấu `\`** (đã gặp nhiều lần).
- Script dùng `mupdf` chạy bằng `node file.mjs`; script TypeScript không dùng `mupdf` chạy bằng `npx tsx`.
- Gọi test production: tạo **người dùng tạm** bằng service role (`admin.auth.admin.createUser`), đăng nhập lấy phiên, dựng cookie `sb-<ref>-auth-token` = `"base64-" + base64url(JSON.stringify(session))` (chia khúc 3.180 ký tự nếu dài), upload file tạm vào Storage, gọi API, rồi `deleteUser` (cascade xóa giáo viên → đề → câu hỏi) và xóa file Storage.
- `vercel env pull .env.vercel.tmp --environment=production --yes` lấy khóa sạch; **xóa file sau dùng**.

### 12.3 Lệnh hay dùng
```bash
npx tsc --noEmit -p .          # kiểm kiểu
npx next build                 # build
git push origin main           # cập nhật GitHub
vercel --prod                  # deploy production
```

### 12.4 Câu hỏi còn mở cho chủ dự án
1. Có bật billing Gemini để tránh 429/hết hạn mức không (chi phí dự kiến dưới 10.000đ/đề)?
2. Có ưu tiên bắt giáo viên nộp **docx gốc** (chính xác 100% công thức) hay chấp nhận PDF là chính?
3. Chính sách phiên bị đuổi: chấm phần đã làm hay không chấm?
4. Giá trị mặc định ngưỡng đuổi (hiện 1 lần vi phạm) có giữ nguyên không?
5. Có cần lưu trữ đề công khai (bản quyền) và quy định bảo mật dữ liệu học sinh không?

### 12.5 Trạng thái triển khai khi lập tài liệu (đã deploy trên production)
Đọc song song đề + đáp án; chế độ chèn `¦` chống RECITATION; tách đôi trang; hàng đợi Gemini đồng thời; chờ `retryDelay` khi 429; luật "file đáp án quyết định loại câu"; sửa loại câu theo hình dạng; gộp ý đúng/sai khi nối trang; sửa tách tiêu đề PHẦN; từ chối docx MathType cũ; upload thẳng Storage; fallback Qwen OpenRouter (không đáng tin). Phần **chưa làm**: toàn bộ kế hoạch mục 6, lưới tọa độ, ảnh crop trong trang duyệt, telemetry, tiến độ/resume.
