"""Wrapper gọi LLM cho pipeline trích xuất — có fallback tự động giữa Gemini và DeepSeek.

Vì sao cần fallback (xem pipeline/LLM_PROVIDERS.md để biết chi tiết điều tra):
- Gemini free tier CÓ giới hạn cứng theo ngày (RPD) — hết quota giữa chừng sẽ lỗi 429 và
  KHÔNG tự phục hồi cho tới nửa đêm giờ Thái Bình Dương (Mỹ). Nếu giáo viên cần trích xuất
  gấp mà quota đã hết, pipeline sẽ tự chuyển sang DeepSeek (nếu có DEEPSEEK_API_KEY) thay vì
  dừng hẳn.
- Free tier Gemini dùng dữ liệu để cải thiện model (Google có thể đọc lại nội dung đề thi).
  Với đề thi CHƯA công bố (sắp thi thật), nên ưu tiên DeepSeek (tài khoản đã nạp tiền không
  bị dùng dữ liệu để train mặc định) bằng cách đặt LLM_PROVIDER=deepseek.
- DeepSeek không có free tier nhưng rất rẻ và từ 09/2026 model deepseek-flash đã hỗ trợ vision
  (nhận ảnh) cùng giá với text — dùng được cho cả OCR ảnh lẫn cấu trúc hóa văn bản.

Biến môi trường điều khiển:
  LLM_PROVIDER = auto (mặc định) | gemini | deepseek
    - auto: thử Gemini trước (free), tự fallback sang DeepSeek nếu Gemini lỗi quota/429
      và có DEEPSEEK_API_KEY. Không có DEEPSEEK_API_KEY thì chỉ dùng Gemini.
    - gemini: chỉ dùng Gemini, không fallback (dừng hẳn nếu hết quota).
    - deepseek: chỉ dùng DeepSeek (khuyến nghị khi đề thi có tính bảo mật).
"""

from __future__ import annotations

import base64
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


class QuotaExhaustedError(Exception):
    """Gemini free tier hết quota (429) — pipeline sẽ bắt lỗi này để fallback sang DeepSeek."""


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text)


def _provider() -> str:
    return os.environ.get("LLM_PROVIDER", "auto").lower()


def _is_quota_error(e: Exception) -> bool:
    msg = str(e).lower()
    return "429" in msg or "quota" in msg or "resource_exhausted" in msg or "resourceexhausted" in msg


# ---------------------------------------------------------------------------
# Cấu trúc hóa văn bản thuần (nhánh A/B: docx đã có text + LaTeX)
# ---------------------------------------------------------------------------


def structure_exam_text(raw_text: str) -> dict:
    provider = _provider()

    if provider == "deepseek":
        return _structure_with_deepseek(raw_text)
    if provider == "gemini":
        return _structure_with_gemini_text(raw_text)

    # auto: ưu tiên Gemini (free) trước, fallback DeepSeek nếu lỗi quota
    try:
        return _structure_with_gemini_text(raw_text)
    except Exception as e:  # noqa: BLE001
        if os.environ.get("DEEPSEEK_API_KEY") and (_is_quota_error(e) or not os.environ.get("GEMINI_API_KEY")):
            print(f"[llm_client] Gemini lỗi ({e}) — fallback sang DeepSeek.")
            return _structure_with_deepseek(raw_text)
        raise


def _structure_with_deepseek(raw_text: str) -> dict:
    import requests

    resp = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"},
        json={
            "model": "deepseek-flash",
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

    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError("Chưa đặt GEMINI_API_KEY")

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash")
    try:
        resp = model.generate_content(
            STRUCTURE_PROMPT.format(content=raw_text),
            generation_config={"temperature": 0, "response_mime_type": "application/json"},
        )
    except Exception as e:  # noqa: BLE001
        if _is_quota_error(e):
            raise QuotaExhaustedError(str(e)) from e
        raise
    return _extract_json(resp.text)


# ---------------------------------------------------------------------------
# OCR ảnh công thức đơn lẻ (nhánh B: WMF/OLE MathType cũ đã convert sang PNG)
# ---------------------------------------------------------------------------


def ocr_equation_image(image_path: str) -> str:
    provider = _provider()

    if provider == "deepseek":
        return _ocr_equation_deepseek(image_path)
    if provider == "gemini":
        return _ocr_equation_gemini(image_path)

    try:
        return _ocr_equation_gemini(image_path)
    except Exception as e:  # noqa: BLE001
        if os.environ.get("DEEPSEEK_API_KEY") and (_is_quota_error(e) or not os.environ.get("GEMINI_API_KEY")):
            print(f"[llm_client] Gemini lỗi ({e}) khi OCR công thức — fallback sang DeepSeek.")
            return _ocr_equation_deepseek(image_path)
        raise


def _ocr_equation_gemini(image_path: str) -> str:
    import google.generativeai as genai
    from PIL import Image

    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError("Chưa đặt GEMINI_API_KEY")

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash-lite")
    img = Image.open(image_path)

    last_err: Exception | None = None
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
        except Exception as e:  # noqa: BLE001
            last_err = e
            if _is_quota_error(e):
                raise QuotaExhaustedError(str(e)) from e
            time.sleep(2**attempt)
    raise last_err  # type: ignore[misc]


def _ocr_equation_deepseek(image_path: str) -> str:
    text = _deepseek_vision_call(
        image_path,
        "Đây là ảnh 1 công thức toán học. Trả về DUY NHẤT chuỗi LaTeX tương ứng, "
        "không giải thích, không bọc trong $ hay code fence.",
    )
    return text.strip().strip("$")


# ---------------------------------------------------------------------------
# OCR + cấu trúc hóa 1 trang PDF (nhánh C: PDF ảnh thuần)
# ---------------------------------------------------------------------------


def ocr_pdf_page_to_json(image_path: str) -> dict:
    provider = _provider()

    if provider == "deepseek":
        return _ocr_pdf_page_deepseek(image_path)
    if provider == "gemini":
        return _ocr_pdf_page_gemini(image_path)

    try:
        return _ocr_pdf_page_gemini(image_path)
    except Exception as e:  # noqa: BLE001
        if os.environ.get("DEEPSEEK_API_KEY") and (_is_quota_error(e) or not os.environ.get("GEMINI_API_KEY")):
            print(f"[llm_client] Gemini lỗi ({e}) khi OCR trang PDF — fallback sang DeepSeek.")
            return _ocr_pdf_page_deepseek(image_path)
        raise


def _ocr_pdf_page_gemini(image_path: str) -> dict:
    import google.generativeai as genai
    from PIL import Image

    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError("Chưa đặt GEMINI_API_KEY")

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.5-flash")
    img = Image.open(image_path)

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = model.generate_content(
                [PDF_PAGE_PROMPT, img],
                generation_config={"temperature": 0, "response_mime_type": "application/json"},
            )
            return _extract_json(resp.text)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if _is_quota_error(e):
                raise QuotaExhaustedError(str(e)) from e
            time.sleep(2**attempt)
    raise last_err  # type: ignore[misc]


def _ocr_pdf_page_deepseek(image_path: str) -> dict:
    text = _deepseek_vision_call(image_path, PDF_PAGE_PROMPT, json_mode=True)
    return _extract_json(text)


def _deepseek_vision_call(image_path: str, prompt: str, json_mode: bool = False) -> str:
    """Gọi deepseek-flash (hỗ trợ vision từ 09/2026) theo format OpenAI-compatible."""
    import requests

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    ext = os.path.splitext(image_path)[1].lstrip(".") or "png"
    body = {
        "model": "deepseek-flash",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/{ext};base64,{b64}"}},
                ],
            }
        ],
        "temperature": 0,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    resp = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"},
        json=body,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]
