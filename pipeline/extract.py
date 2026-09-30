#!/usr/bin/env python
"""CLI trích xuất đề thi từ file Word/PDF thành JSON + thư mục ảnh để import vào web app.

Cách dùng:
    python extract.py "De 0101-Giai-THPT 2025.docx" --out output/de0101

Kết quả:
    output/de0101/exam.json    — theo schema ExtractedExam (src/types/exam.ts)
    output/de0101/images/      — toàn bộ ảnh minh họa + ảnh công thức chưa nhận dạng (nếu có)

Sau đó vào Dashboard giáo viên > Tạo đề thi mới > chọn file exam.json + toàn bộ ảnh trong
thư mục images/ để import.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from docx_extract import detect_branch as detect_docx_branch, extract_docx
from pdf_extract import extract_pdf, has_text_layer
from llm_client import structure_exam_text


def run(input_path: str, output_dir: str, skip_ole_ocr: bool = False):
    ext = Path(input_path).suffix.lower()
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []

    if ext == ".docx":
        branch = detect_docx_branch(input_path)
        print(f"[extract] Phát hiện nhánh: {branch}")
        if branch == "NO_MATH_DETECTED":
            print("[extract] Cảnh báo: không tìm thấy công thức toán nào trong file.")

        result = extract_docx(input_path, output_dir, ocr_ole_equations=not skip_ole_ocr)
        warnings.extend(result["warnings"])

        print("[extract] Đang gọi LLM cấu trúc hóa câu hỏi (có thể mất 1-2 phút)...")
        structured = structure_exam_text(result["text"])
        structured.setdefault("source_branch", branch)

    elif ext == ".pdf":
        if has_text_layer(input_path):
            print(
                "[extract] Cảnh báo: PDF có lớp text (PDF_TEXT_LAYER) — pipeline hiện tối ưu "
                "cho PDF ảnh thuần (PDF_IMAGE_ONLY). Vẫn xử lý bằng OCR vision, có thể chưa tối ưu."
            )
        print("[extract] Đang render + OCR từng trang bằng Gemini vision...")
        result = extract_pdf(input_path, output_dir)
        warnings.extend(result["warnings"])
        structured = {
            "title": Path(input_path).stem,
            "subject": "",
            "source_branch": "PDF_IMAGE_ONLY",
            "questions": result["questions"],
        }

    else:
        print(f"[extract] Định dạng không hỗ trợ: {ext}", file=sys.stderr)
        sys.exit(1)

    for q in structured.get("questions", []):
        q.setdefault("image_url", None)
        q.setdefault("raw_ocr_notes", None)
        q.setdefault("options", [])
        q.setdefault("sub_statements", [])
        q.setdefault("correct_answer", None)
        q.setdefault("short_answer_normalized", None)
        q.setdefault("score_rule", "standard")
        q.setdefault("max_score", 0.25)

    out_json = Path(output_dir) / "exam.json"
    out_json.write_text(json.dumps(structured, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n[extract] Hoàn tất: {len(structured.get('questions', []))} câu hỏi")
    print(f"[extract] JSON: {out_json}")
    print(f"[extract] Ảnh: {Path(output_dir) / 'images'}")
    if warnings:
        print(f"\n[extract] {len(warnings)} cảnh báo cần giáo viên rà soát tại Review UI:")
        for w in warnings[:10]:
            print(f"  - {w}")
        if len(warnings) > 10:
            print(f"  ... và {len(warnings) - 10} cảnh báo khác")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trích xuất đề thi Word/PDF sang JSON")
    parser.add_argument("input", help="Đường dẫn file .docx hoặc .pdf")
    parser.add_argument("--out", required=True, help="Thư mục output")
    parser.add_argument(
        "--skip-ole-ocr",
        action="store_true",
        help="Bỏ qua OCR công thức MathType cũ (WMF) dù có LibreOffice — chỉ trích text thô",
    )
    args = parser.parse_args()

    provider = os.environ.get("LLM_PROVIDER", "auto").lower()
    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    has_deepseek = bool(os.environ.get("DEEPSEEK_API_KEY"))

    if provider == "gemini" and not has_gemini:
        print("[extract] LỖI: LLM_PROVIDER=gemini nhưng chưa đặt GEMINI_API_KEY.", file=sys.stderr)
        sys.exit(1)
    if provider == "deepseek" and not has_deepseek:
        print("[extract] LỖI: LLM_PROVIDER=deepseek nhưng chưa đặt DEEPSEEK_API_KEY.", file=sys.stderr)
        sys.exit(1)
    if provider == "auto" and not has_gemini and not has_deepseek:
        print(
            "[extract] LỖI: chưa đặt GEMINI_API_KEY hoặc DEEPSEEK_API_KEY.\n"
            "  Gemini (miễn phí, có giới hạn/ngày): https://aistudio.google.com/apikey\n"
            "  DeepSeek (trả phí rất rẻ, không giới hạn/ngày, bảo mật hơn cho đề chưa công bố):\n"
            "  https://platform.deepseek.com/api_keys\n"
            "  export GEMINI_API_KEY=xxxx   (Linux/Mac/Git Bash)\n"
            "  $env:GEMINI_API_KEY='xxxx'   (PowerShell)",
            file=sys.stderr,
        )
        sys.exit(1)
    if provider == "auto" and not has_gemini and has_deepseek:
        print("[extract] Không có GEMINI_API_KEY — dùng DeepSeek cho toàn bộ pipeline.")

    run(args.input, args.out, skip_ole_ocr=args.skip_ole_ocr)
