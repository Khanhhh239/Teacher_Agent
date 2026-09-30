# Điều tra: Gemini free tier có dùng được không? Nếu hết quota thì sao?

Tra cứu thực hiện 2026-09-30. Số liệu quota có thể thay đổi — tự kiểm tra lại tại
https://ai.google.dev/gemini-api/docs/rate-limits khi có API key thật.

## 1. Gemini free tier hiện tại (sau khi Google loại Pro khỏi free tier từ 4/2026)

| Model | RPM (request/phút) | RPD (request/ngày) | TPM (token/phút) |
|---|---|---|---|
| gemini-2.5-flash | ~10 | ~500 (một số nguồn ghi 1500, không nhất quán giữa các bài viết bên thứ 3) | 250.000 |
| gemini-2.5-flash-lite | 15 | 1.500 | 250.000 |
| gemini-2.5-pro | **Không còn free từ 4/2026** — chỉ trả phí | — | — |

Pipeline đang dùng `gemini-2.5-flash-lite` cho OCR từng công thức (nhánh MathType cũ) và
`gemini-2.5-flash` cho OCR/cấu trúc hóa từng trang PDF — cả hai đều còn free tier.

## 2. Hết quota thì chuyện gì xảy ra?

- Lỗi trả về: **429 RESOURCE_EXHAUSTED**.
- Quota theo ngày (RPD) reset vào **nửa đêm giờ Thái Bình Dương (Mỹ)** — tức khoảng 14h-15h
  chiều giờ Việt Nam (tuỳ giờ mùa hè/đông của Mỹ). Trong lúc chờ reset, **không gọi được nữa**,
  không phải lỗi tạm thời retry vài giây là hết.
- Quota theo phút (RPM) chỉ cần chờ dưới 1 phút là gọi lại được — pipeline đã tự retry 3 lần
  với backoff cho lỗi loại này.

**Rủi ro thực tế với quy mô của bạn (vài chục học sinh, up đề theo đợt)**: 1 đề thi PDF 4 trang
tốn 4 lần gọi Gemini (Nhánh C) hoặc vài chục lần gọi (Nhánh B, mỗi công thức 1 lần) — nằm rất xa
giới hạn 500-1500 request/ngày. Chỉ gặp vấn đề nếu bạn trích xuất **rất nhiều đề cùng lúc trong
1 ngày** (vd >100 trang PDF hoặc >500 công thức MathType cũ trong 1 ngày).

## 3. Rủi ro bảo mật ít ai để ý: free tier dùng dữ liệu để train model

Theo chính sách Gemini API: **free tier (không gắn thẻ thanh toán) — nội dung bạn gửi CÓ THỂ
được Google dùng để cải thiện model, và con người (reviewer) có thể đọc lại.** Trả phí (bật
billing) thì KHÔNG bị dùng để train.

**Áp dụng vào bài toán của bạn:**
- Đề thi ĐÃ CÔNG BỐ công khai (như đề THPT 2025 đã thi xong) → rủi ro gần như bằng 0, dữ liệu
  đã public rồi.
- Đề thi giáo viên tự soạn **CHƯA công bố, sắp cho học sinh thi thật** → có rủi ro lộ đề nếu
  dùng Gemini free tier, vì nội dung có thể bị lưu lại/con người đọc được.

## 4. DeepSeek — lựa chọn thay thế (đã cập nhật code hỗ trợ song song)

- **Không có free tier** — trả phí ngay từ token đầu tiên, nhưng cực rẻ: `deepseek-flash`
  ~$0.3/1M input token, ~$1.2/1M output token (giờ cao điểm UTC 1-4h & 6-10h các ngày trong
  tuần; ngoài giờ đó giá giảm một nửa). Trích xuất 1 đề thi vài chục câu tốn khoảng vài nghìn
  đến vài chục nghìn VNĐ.
- **Từ 09/2026, `deepseek-flash` đã hỗ trợ vision (nhận ảnh)** cùng giá với text — nghĩa là
  DeepSeek giờ thay thế được Gemini cho CẢ 2 việc: OCR ảnh công thức/trang PDF, và cấu trúc hóa
  văn bản thành JSON câu hỏi. Không cần 2 provider khác nhau nữa nếu bạn chọn dùng hẳn DeepSeek.
- **Bảo mật tốt hơn cho đề chưa công bố**: theo chính sách cập nhật 3/2026, tài khoản API đã
  nạp tiền (paid) KHÔNG bị dùng dữ liệu để train mặc định — khác với Gemini free tier.

## 5. Khuyến nghị đã áp dụng vào code

`pipeline/llm_client.py` giờ có biến `LLM_PROVIDER`:

- **`auto` (mặc định)** — thử Gemini free trước; nếu gặp lỗi 429/quota VÀ có
  `DEEPSEEK_API_KEY`, tự động chuyển sang DeepSeek cho request đó, in log rõ ràng để bạn biết
  đã fallback. Không có `DEEPSEEK_API_KEY` thì dừng lại báo lỗi hết quota (không có gì mất tiền
  ngoài ý muốn).
- **`gemini`** — ép chỉ dùng Gemini, dừng hẳn nếu hết quota (dùng khi bạn chắc chắn không dùng
  DeepSeek và muốn thấy lỗi rõ ràng thay vì tự chuyển provider).
- **`deepseek`** — ép chỉ dùng DeepSeek, khuyến nghị khi trích xuất đề thi **chưa công bố**.

Cách bật fallback: chỉ cần đặt cả `GEMINI_API_KEY` và `DEEPSEEK_API_KEY` trong `.env.local`,
để `LLM_PROVIDER=auto` (mặc định) — không cần sửa code thêm.
