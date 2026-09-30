"""Nhánh C: PDF không có lớp text (phổ biến với đề thi chính thức xuất ra PDF phẳng).

Render mỗi trang ra ảnh độ phân giải cao, gửi Gemini 2.5 Flash (vision) để OCR + cấu trúc
hóa trực tiếp thành câu hỏi JSON kèm bbox hình vẽ minh họa, sau đó crop hình theo bbox
Gemini trả về.
"""

from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from llm_client import ocr_pdf_page_to_json


def has_text_layer(pdf_path: str) -> bool:
    doc = fitz.open(pdf_path)
    return any(page.get_text().strip() for page in doc)


def extract_pdf(pdf_path: str, output_dir: str, dpi: int = 250) -> dict:
    images_dir = Path(output_dir) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    all_questions: list[dict] = []
    warnings: list[str] = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        pix = page.get_pixmap(dpi=dpi)
        page_png_path = images_dir / f"_page_{page_index + 1}.png"
        pix.save(str(page_png_path))

        try:
            page_result = ocr_pdf_page_to_json(str(page_png_path))
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Trang {page_index + 1}: lỗi OCR Gemini — {e}")
            continue

        figures = {f["id"]: f["bbox_1000"] for f in page_result.get("figures", [])}
        page_img = Image.open(page_png_path)
        w, h = page_img.size

        figure_files: dict[str, str] = {}
        for fig_id, bbox in figures.items():
            x0, y0, x1, y1 = bbox
            crop_box = (
                int(x0 / 1000 * w),
                int(y0 / 1000 * h),
                int(x1 / 1000 * w),
                int(y1 / 1000 * h),
            )
            if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
                continue
            fname = f"page{page_index + 1}_{fig_id}.png"
            page_img.crop(crop_box).save(images_dir / fname)
            figure_files[fig_id] = fname

        for q in page_result.get("questions", []):
            fig_ref = q.pop("figure_ref", None)
            q["image_url"] = figure_files.get(fig_ref)
            q.setdefault("raw_ocr_notes", None)
            all_questions.append(q)

        page_png_path.unlink(missing_ok=True)  # chỉ cần ảnh crop, không cần giữ ảnh cả trang

    return {"questions": all_questions, "warnings": warnings}
