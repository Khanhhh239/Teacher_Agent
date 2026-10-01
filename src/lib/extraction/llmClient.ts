import { Agent, fetch as undiciFetch } from "undici";
import type { ExtractedExam } from "@/types/exam";

/**
 * Gọi LLM (Gemini free tier ưu tiên, tự fallback DeepSeek nếu hết quota/lỗi) để cấu trúc
 * hóa đề thi — chạy trong Vercel serverless function (Node runtime), không cần Python.
 * Xem pipeline/LLM_PROVIDERS.md để biết phân tích chi tiết free tier/quota/bảo mật.
 *
 * Lưu ý: Node's global fetch (undici) mặc định headersTimeout ngắn hơn thời gian Gemini
 * cần để sinh JSON dài (đề thi 20+ câu có thể mất 30-90s) — dùng dispatcher riêng tăng
 * timeout lên 110s (dưới maxDuration=60s của route hiện tại chỉ để tránh lỗi treo sớm;
 * bản thân request vẫn bị Vercel cắt ở giới hạn maxDuration nếu Gemini quá chậm).
 */
const longTimeoutDispatcher = new Agent({
  headersTimeout: 170_000,
  bodyTimeout: 170_000,
});

const STRUCTURE_PROMPT = `Bạn là trợ lý số hóa đề thi tiếng Việt. Dưới đây là nội dung một đề thi đã được trích xuất thô (có thể lẫn lỗi định dạng nhẹ). Hãy cấu trúc hóa thành JSON theo đúng schema sau, KHÔNG thêm giải thích ngoài JSON.

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
- "multiple_choice": 4 lựa chọn A/B/C/D, chỉ 1 đáp án đúng. max_score mặc định 0.25, score_rule "standard".
- "true_false_group": 4 mệnh đề con a/b/c/d, mỗi mệnh đề Đúng/Sai độc lập. max_score mặc định 1.0, score_rule "thpt2025_truefalse_partial".
- "short_answer": điền một giá trị số/chuỗi ngắn. max_score mặc định 0.5, score_rule "standard".

Nếu có đáp án/lời giải đi kèm, dùng để điền correct_answer / sub_statements[].answer / short_answer_normalized. Nếu KHÔNG chắc chắn, để null và ghi rõ lý do vào raw_ocr_notes — TUYỆT ĐỐI không bịa đáp án. Nếu gặp marker dạng "[IMAGE:tên_file]" trong văn bản, gán chuỗi tên_file đó (không có ngoặc) vào "image_url" của câu hỏi tương ứng, đồng thời XOÁ hẳn marker "[IMAGE:...]" đó khỏi content_latex (không để sót lại trong văn bản hiển thị cho học sinh). Nếu gặp marker ngắn dạng "[CT?N]" (N là số), GIỮ NGUYÊN marker đó đúng y hệt tại vị trí xuất hiện trong content_latex hoặc text_latex (không viết lại, không mở rộng thành câu dài) — đây là công thức MathType cũ hệ thống chưa OCR được, chỉ cần đặt raw_ocr_notes = "Có công thức cần giáo viên nhập tay (đánh dấu [CT?N] trong nội dung)." một lần duy nhất cho câu hỏi đó, không lặp lại giải thích dài trong content_latex.

Chỉ trả về JSON hợp lệ, không markdown, không code fence.`;

const PDF_PROMPT = `Bạn là trợ lý số hóa đề thi tiếng Việt. Đọc toàn bộ file PDF đính kèm (đề thi, có thể nhiều trang, chữ tiếng Việt có dấu, công thức toán, hình vẽ minh họa) và trả về DUY NHẤT 1 JSON theo schema:

{
  "title": "tên đề thi",
  "subject": "môn học",
  "questions": [
    {
      "type": "multiple_choice" | "true_false_group" | "short_answer",
      "content_latex": "nội dung câu hỏi, công thức toán bọc trong $...$",
      "image_url": null,
      "options": [{"key": "A", "text_latex": "..."}],
      "sub_statements": [{"key": "a", "text_latex": "...", "answer": true}],
      "correct_answer": "A hoặc null nếu trang PDF không có đáp án kèm theo",
      "short_answer_normalized": "đáp án hoặc null",
      "score_rule": "standard" | "thpt2025_truefalse_partial",
      "max_score": 0.25,
      "raw_ocr_notes": "ghi chú nếu câu này có hình vẽ minh họa mà bạn không thể mô tả bằng text (vd: 'Câu này có hình vẽ lăng trụ ABC.A'B'C' kèm theo, giáo viên cần tự chèn ảnh minh họa'), hoặc null"
    }
  ]
}

Quy tắc:
- "multiple_choice": 4 lựa chọn A/B/C/D. max_score 0.25, score_rule "standard".
- "true_false_group": 4 mệnh đề con a/b/c/d. max_score 1.0, score_rule "thpt2025_truefalse_partial".
- "short_answer": điền giá trị ngắn. max_score 0.5, score_rule "standard".
- image_url luôn để null (hệ thống chưa tự cắt ảnh từ PDF) — nhưng PHẢI ghi chú vào raw_ocr_notes nếu câu có hình vẽ kèm theo để giáo viên biết cần tự thêm ảnh.
- Nếu có đáp án/lời giải trong PDF (một số đề có kèm đáp án ở cuối), dùng để điền đáp án đúng. Nếu không, để null, TUYỆT ĐỐI không bịa.

Chỉ trả JSON hợp lệ, không markdown, không code fence.`;

/**
 * LLM thường xuất backslash LaTeX (\vec, \frac, \left...) trong chuỗi JSON mà KHÔNG
 * escape kép (\\vec) như chuẩn JSON yêu cầu — gây lỗi "Bad escaped character".
 * Tự động escape mọi backslash không nằm trong 1 escape sequence JSON hợp lệ
 * (\" \\ \/ \b \f \n \r \t \uXXXX) trước khi parse, chỉ áp dụng bên trong chuỗi
 * (giữa 2 dấu ") để không phá cấu trúc JSON.
 */
const LETTER = /[a-zA-Z]/;

export function fixLatexBackslashes(text: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '"' && text[i - 1] !== "\\") {
      inString = !inString;
      out += ch;
      i++;
      continue;
    }

    if (inString && ch === "\\") {
      const next = text[i + 1];
      const afterNext = text[i + 2];

      if (next === "\\" || next === '"' || next === "/" || next === "u") {
        // Escape 2 ký tự hợp lệ đã đúng chuẩn (\\ \" \/ \uXXXX) — giữ nguyên cả 2 ký tự,
        // KHÔNG xét riêng ký tự thứ 2 ở vòng lặp sau (tránh đếm lệch như bug cũ).
        out += ch + next;
        i += 2;
        continue;
      }

      if (next && "bfnrt".includes(next) && !(afterNext && LETTER.test(afterNext))) {
        // Escape 1 ký tự hợp lệ (\b \f \n \r \t) và KHÔNG có thêm chữ cái theo ngay sau
        // → gần như chắc chắn là escape thật (vd \n ngăn cách đoạn), không phải LaTeX.
        out += ch + next;
        i += 2;
        continue;
      }

      // Còn lại: backslash đứng trước 1 chữ cái mà theo sau là 1+ chữ cái nữa (vd \vec,
      // \left, \nabla, \frac) → gần như chắc chắn là lệnh LaTeX chưa được LLM escape kép
      // theo chuẩn JSON. Escape lại thành \\ để JSON.parse không lỗi.
      out += "\\\\";
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

function extractJson(text: string): unknown {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.split("```")[1] ?? t;
    if (t.startsWith("json")) t = t.slice(4);
  }
  try {
    return JSON.parse(t);
  } catch {
    const fixed = fixLatexBackslashes(t);
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      if (process.env.DEBUG_EXTRACT_JSON) {
        console.error("---RAW---\n" + t + "\n---FIXED---\n" + fixed);
      }
      throw e2;
    }
  }
}

function isTransientError(message: string): boolean {
  const m = message.toLowerCase();
  return [
    "429",
    "503",
    "quota",
    "resource_exhausted",
    "unavailable",
    "overloaded",
    "timeout",
    "fetch failed",
  ].some((s) => m.includes(s));
}

// flash-lite nhanh & ổn định hơn hẳn "flash" đầy đủ cho cả 2 tác vụ — đã test thực tế:
// flash "đầy đủ" có lúc mất >110s để sinh JSON cho đề 20+ câu hoặc trả 503 quá tải liên
// tục (kể cả cho PDF vision), trong khi flash-lite phản hồi ổn định trong vài giây và vẫn
// đọc hiểu PDF (text + hình + bố cục) chính xác khi test trực tiếp trên đề mẫu thật.
const GEMINI_MODEL_TEXT = "gemini-3.5-flash-lite";
const GEMINI_MODEL_VISION = "gemini-3.5-flash-lite";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gọi Gemini generateContent với parts tuỳ ý, tự retry 2 lần (backoff 2s) khi gặp lỗi
 * tạm thời (429 hết quota, 503 quá tải, hoặc timeout mạng) — đây là lỗi thoáng qua chứ
 * không phải lỗi code. Chỉ retry 2 lần (không phải 3) để tổng thời gian không vượt quá
 * maxDuration của route (180s). */
async function callGeminiRaw(model: string, parts: unknown[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Chưa cấu hình GEMINI_API_KEY");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await undiciFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" },
          }),
          dispatcher: longTimeoutDispatcher,
        }
      );
      const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!res.ok) throw new Error(`Gemini lỗi ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini không trả về nội dung: " + JSON.stringify(data).slice(0, 300));
      return text;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const transient = isTransientError(lastError.message);
      if (!transient || attempt === 1) throw lastError;
      await sleep(2000);
    }
  }
  throw lastError ?? new Error("Gemini: lỗi không xác định");
}

async function callGeminiText(prompt: string): Promise<string> {
  return callGeminiRaw(GEMINI_MODEL_TEXT, [{ text: prompt }]);
}

async function callGeminiWithPdf(pdfBase64: string, prompt: string): Promise<string> {
  return callGeminiRaw(GEMINI_MODEL_VISION, [
    { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
    { text: prompt },
  ]);
}

async function callDeepseekText(prompt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Chưa cấu hình DEEPSEEK_API_KEY");

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) throw new Error(`DeepSeek lỗi ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.choices[0].message.content;
}

async function callDeepseekWithPdfAsImages(_pdfBase64: string): Promise<never> {
  throw new Error("DeepSeek chưa hỗ trợ nhận file PDF trực tiếp trong pipeline này — dùng Gemini cho nhánh PDF.");
}

function provider(): "auto" | "gemini" | "deepseek" {
  const p = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  return p === "gemini" || p === "deepseek" ? p : "auto";
}

export async function structureExamText(rawText: string): Promise<ExtractedExam> {
  const prompt = STRUCTURE_PROMPT + "\n\nNội dung đề thi cần cấu trúc hóa:\n---\n" + rawText + "\n---";
  const p = provider();

  if (p === "deepseek") return extractJson(await callDeepseekText(prompt)) as ExtractedExam;
  if (p === "gemini") return extractJson(await callGeminiText(prompt)) as ExtractedExam;

  try {
    return extractJson(await callGeminiText(prompt)) as ExtractedExam;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.env.DEEPSEEK_API_KEY && (isTransientError(msg) || !process.env.GEMINI_API_KEY)) {
      return extractJson(await callDeepseekText(prompt)) as ExtractedExam;
    }
    throw e;
  }
}

export async function extractPdfWithVision(pdfBuffer: Buffer): Promise<ExtractedExam> {
  const p = provider();
  if (p === "deepseek") return callDeepseekWithPdfAsImages(pdfBuffer.toString("base64"));

  const base64 = pdfBuffer.toString("base64");
  try {
    return extractJson(await callGeminiWithPdf(base64, PDF_PROMPT)) as ExtractedExam;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Không xử lý được file PDF bằng Gemini vision (${msg}). ` +
        (process.env.DEEPSEEK_API_KEY
          ? "DeepSeek hiện chưa hỗ trợ trong pipeline này cho nhánh PDF."
          : "Thử thêm GEMINI_API_KEY hoặc thử lại sau vài phút nếu đây là lỗi quá tải tạm thời.")
    );
  }
}
