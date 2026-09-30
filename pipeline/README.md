# Extraction Pipeline

Chạy độc lập với web app (không phải Vercel function) — xem lý do trong kế hoạch triển khai.

## Cài đặt

```bash
pip install -r requirements.txt
```

**Tuỳ chọn nhưng khuyến nghị** — cài LibreOffice để OCR được công thức MathType cũ (ảnh WMF, nhánh `LEGACY_OLE_IMAGE`). Không có LibreOffice, pipeline vẫn chạy nhưng sẽ chèn placeholder `[CÔNG THỨC CHƯA NHẬN DẠNG]` và lưu ảnh WMF gốc để bạn tự nhập tay tại Review UI.

- Windows: tải tại https://www.libreoffice.org/download/download/, cài xong đảm bảo `soffice.exe` nằm trong PATH (thường tại `C:\Program Files\LibreOffice\program`).
- macOS: `brew install --cask libreoffice`
- Linux: `sudo apt install libreoffice`

## Cấu hình API key

```bash
export GEMINI_API_KEY=xxxx      # bắt buộc — lấy miễn phí tại https://aistudio.google.com/apikey
export DEEPSEEK_API_KEY=xxxx    # tuỳ chọn — nếu có, dùng DeepSeek-V3 (rẻ hơn) cho bước cấu trúc hóa text thay vì Gemini
```

## Chạy

```bash
python extract.py "De 0101-Giai-THPT 2025.docx" --out output/de0101
python extract.py "De 1-Giai.docx" --out output/de1
python extract.py "De 0101-THPT 2025-CT.pdf" --out output/de0101_pdf
```

Kết quả: `output/<tên>/exam.json` + `output/<tên>/images/`. Vào Dashboard giáo viên trên web →
**Tạo đề thi mới** → chọn file `exam.json` và **toàn bộ** file trong thư mục `images/` để import.

## 3 nhánh xử lý

| Nhánh | Điều kiện phát hiện | Chi phí AI |
|---|---|---|
| `OMML_NATIVE` | `.docx` có `<m:oMath>` (Word Equation Editor hiện đại) | 0đ — convert LaTeX bằng `omml2latex.py`, không gọi AI |
| `LEGACY_OLE_IMAGE` | `.docx` có `<w:object>` (MathType cũ, công thức là ảnh WMF) | Cần Gemini vision cho mỗi công thức (rẻ, có free tier) |
| `PDF_IMAGE_ONLY` | `.pdf` không có lớp text | Cần Gemini vision cho mỗi trang |

Dù là nhánh nào, **bước cấu trúc hóa câu hỏi** (tách câu, phân loại trắc nghiệm/đúng-sai/trả
lời ngắn, nhận đáp án) đều cần LLM (DeepSeek-V3 hoặc Gemini) — không có nhánh nào "miễn phí
hoàn toàn" nếu muốn ra JSON câu hỏi có cấu trúc đầy đủ, không chỉ riêng LaTeX.

## Giới hạn đã biết

- OMML→LaTeX tự viết (`omml2latex.py`) bao phủ phần lớn cấu trúc phổ biến (phân số, lũy thừa,
  căn, vecto, tích phân/tổng, ma trận, ngoặc) nhưng không phủ 100% mọi trường hợp OMML — phần
  không nhận diện được sẽ giữ nguyên text thô.
- LLM cấu trúc hóa có thể phân loại sai loại câu hoặc gán nhầm điểm mặc định — **Review UI là
  bước bắt buộc**, không tạo phòng thi thẳng từ output pipeline.
- Với PDF nhiều trang, mỗi trang tốn 1 lần gọi Gemini vision — đề dài (vd 4 trang như mẫu) vẫn
  nằm gọn trong free tier (15 RPM/1000 RPD), nhưng đề rất dài hoặc nhiều đề cùng lúc có thể chạm
  giới hạn free tier, cần chờ hoặc nâng cấp trả phí.
