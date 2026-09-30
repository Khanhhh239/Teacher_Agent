"""Wrapper gọi Gemini (vision + text) và DeepSeek-V3 (text) cho pipeline trích xuất.

Thiết kế: Gemini dùng cho mọi bước cần Vision (OCR ảnh công thức, OCR trang PDF).
DeepSeek-V3 dùng cho bước NER/cấu trúc hóa văn bản thuần (rẻ hơn Gemini cho text-only),
nhưng nếu không có DEEPSEEK_API_KEY thì fallback dùng Gemini cho luôn bước này.
"""

from __future__ import annotations

import json
import os
import time

STRUCTURE_PROMPT = """Bạn là trợ lý số hóa đề thi tiếng Việt. Dưới đây là nội dung một đề thi đã được OCR/trích xuất thô (có thể lẫn lỗi định dạng nhẹ). Hãy cấu trúc hóa thành JSON theo đúng schema sau, KHÔNG thêm giải thích ngoài JSON.

Schema JSON trả về:
{
  "title": "tên đề thi suy ra từ nội dung",
  "subject": "môn học (Toán/Lý/Hóa/...)",
  "questions": [
    {
      "type": "multiple_choice" | "true_false_group" | "short_answer",
      "content_latex": "nội dung câu hỏi, công thức toán bọc trong $...$",
      "image_url": null,
      "options": [{"key": "A", "text_latex": "..."}],
      "sub_statements": [{"key": "a", "text_latex": "...", "answer": true}],
      "correct_answer": "A hoặc null",
      "short_answer_normalized": "đáp án dạng chuỗi hoặc null",
      "score_rule": "standard" | "thpt2025_truefalse_partial",
      "max_score": 0.25,
      "raw_ocr_notes": null
    }
  ]
}

Quy tắc phân loại và điểm mặc định theo cấu trúc đề THPT Việt Nam (áp dụng nếu không có thông tin khác):
- "multiple_choice": câu hỏi có 4 lựa chọn A/B/C/D, chỉ 1 đáp án đúng. max_score mặc định 0.25, score_rule "standard".
- "true_false_group": câu hỏi có 4 mệnh đề con a/b/c/d, mỗi mệnh đề Đúng hoặc Sai độc lập. max_score mặc định 1.0, score_rule "thpt2025_truefalse_partial".
- "short_answer": câu hỏi yêu cầu điền một giá trị số/chuỗi ngắn. max_score mặc định 0.5, score_rule "standard".

Nếu văn bản có đáp án/lời giải đi kèm (thường ở cuối hoặc trong ngoặc), hãy dùng để điền correct_answer / sub_statements[].answer / short_answer_normalized. Nếu KHÔNG chắc chắn về đáp án đúng, để null và ghi rõ lý do vào raw_ocr_notes để giáo viên tự điền — TUYỆT ĐỐI không bịa đáp án.

Nội dung đề thi cần cấu trúc hóa:
---
{content}
---

Chỉ trả về JSON hợp lệ, không markdown, không code fence."""


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)


def structure_exam_text(raw_text: str) -> dict:
    """Gọi LLM (ưu tiên DeepSeek, fallback Gemini) để cấu trúc hóa văn bản đề thi thô
    thành JSON theo schema ExtractedExam."""
    if os.environ.get("DEEPSEEK_API_KEY"):
        return _structure_with_deepseek(raw_text)
    return _structure_with_gemini_text(raw_text)


def _structure_with_deepseek(raw_text: str) -> dict:
    import requests

    resp = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"},
        json={
            "model": "deepseek-chat",
            "messages": [
                {"role": "user", "content": STRUCTURE_PROMPT.format(content=raw_text)}
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return _extract_json(content)


def _structure_with_gemini_text(raw_text: str) -> dict:
    import google.generativeai as genai

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash")
    resp = model.generate_content(
        STRUCTURE_PROMPT.format(content=raw_text),
        generation_config={"temperature": 0, "response_mime_type": "application/json"},
    )
    return _extract_json(resp.text)


def ocr_equation_image(image_path: str) -> str:
    """Gửi 1 ảnh công thức (crop nhỏ) tới Gemini vision, trả về chuỗi LaTeX (không có $)."""
    import google.generativeai as genai
    from PIL import Image

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash-lite")
    img = Image.open(image_path)

    for attempt in range(3):
        try:
            resp = model.generate_content(
                [
                    "Đây là ảnh 1 công thức toán học. Trả về DUY NHẤT chuỗi LaTeX tương ứng, "
                    "không giải thích, không bọc trong $ hay code fence.",
                    img,
                ],
                generation_config={"temperature": 0},
            )
            return resp.text.strip().strip("$")
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2**attempt)
    return ""


PDF_PAGE_PROMPT = """Bạn là trợ lý số hóa đề thi tiếng Việt. Đọc ảnh 1 trang đề thi đính kèm (chữ tiếng Việt có dấu, công thức toán, hình vẽ minh họa) và trả về DUY NHẤT 1 JSON theo schema:

{
  "questions": [
    {
      "type": "multiple_choice" | "true_false_group" | "short_answer",
      "content_latex": "nội dung câu hỏi, công thức toán bọc trong $...$",
      "figure_ref": "fig1 hoặc null nếu câu này không có hình vẽ kèm theo",
      "options": [{"key": "A", "text_latex": "..."}],
      "sub_statements": [{"key": "a", "text_latex": "...", "answer": null}],
      "correct_answer": null,
      "short_answer_normalized": null,
      "score_rule": "standard" | "thpt2025_truefalse_partial",
      "max_score": 0.25
    }
  ],
  "figures": [
    {"id": "fig1", "bbox_1000": [x0, y0, x1, y1]}
  ]
}

Quy tắc:
- "multiple_choice": 4 lựa chọn A/B/C/D. max_score 0.25, score_rule "standard".
- "true_false_group": 4 mệnh đề con a/b/c/d. max_score 1.0, score_rule "thpt2025_truefalse_partial".
- "short_answer": điền giá trị ngắn. max_score 0.5, score_rule "standard".
- Trang này KHÔNG có đáp án/lời giải kèm theo — để correct_answer/sub_statements[].answer/short_answer_normalized là null, giáo viên sẽ điền tay sau.
- "bbox_1000": toạ độ khung hình vẽ minh họa (không phải icon trang trí), chuẩn hoá theo thang 0-1000 trên cả 2 trục [x0,y0,x1,y1] (góc trên-trái tới góc dưới-phải).
- Nếu 1 câu hỏi bắt đầu ở trang trước và tiếp tục ở trang này (bị cắt trang), chỉ trả phần thuộc trang này, đánh dấu vào content_latex bằng tiền tố "[TIẾP TRANG TRƯỚC] ".

Chỉ trả JSON hợp lệ, không markdown, không code fence."""


def ocr_pdf_page_to_json(image_path: str) -> dict:
    """Gửi 1 trang PDF (ảnh full trang) tới Gemini vision, yêu cầu trả JSON cấu trúc hóa
    trực tiếp câu hỏi + bbox hình vẽ trên trang đó."""
    import google.generativeai as genai
    from PIL import Image

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash")
    img = Image.open(image_path)

    for attempt in range(3):
        try:
            resp = model.generate_content(
                [PDF_PAGE_PROMPT, img],
                generation_config={"temperature": 0, "response_mime_type": "application/json"},
            )
            return _extract_json(resp.text)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2**attempt)
    return {"questions": [], "figures": []}
