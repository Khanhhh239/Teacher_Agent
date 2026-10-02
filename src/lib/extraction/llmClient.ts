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
      "image_urls": [],
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

QUAN TRỌNG — KHÔNG được lặp nội dung: "content_latex" CHỈ chứa phần dẫn đề dùng chung (đoạn văn/bài toán trước khi liệt kê lựa chọn), TUYỆT ĐỐI KHÔNG được chép lại các lựa chọn A/B/C/D hay các mệnh đề a)/b)/c)/d) vào trong content_latex — các lựa chọn/mệnh đề đó CHỈ xuất hiện trong "options"/"sub_statements". Giao diện hiển thị content_latex và options/sub_statements RIÊNG BIỆT, nếu lặp cả 2 nơi học sinh sẽ thấy đáp án hiện trùng 2 lần.

Nếu đề bài có bảng số liệu (vd bảng tần số ghép nhóm), trình bày bằng cú pháp Markdown table ngay trong content_latex, ví dụ: "| Nhóm | [0;40) | [40;80) |\n| --- | --- | --- |\n| Tần số | 11 | 10 |". TUYỆT ĐỐI KHÔNG dùng \\begin{tabular}...\\end{tabular} hay bất kỳ cú pháp LaTeX bảng nào khác — hệ thống hiển thị bằng KaTeX, không render được môi trường bảng LaTeX, chỉ render được công thức toán đơn lẻ trong $...$ và bảng Markdown.

Nếu đề bài liệt kê các điều kiện/ý bằng gạch đầu dòng "+", "-", "•" (ví dụ: "...thỏa mãn đồng thời: + Điều kiện 1; + Điều kiện 2."), PHẢI chèn ký tự xuống dòng thật "\n" trước MỖI gạch đầu dòng để mỗi ý nằm riêng 1 dòng — không được viết dính liền thành 1 đoạn văn.

Nếu có đáp án/lời giải đi kèm, dùng để điền correct_answer / sub_statements[].answer / short_answer_normalized. Nếu KHÔNG chắc chắn, để null và ghi rõ lý do vào raw_ocr_notes — TUYỆT ĐỐI không bịa đáp án.

Xử lý marker trong văn bản (BẮT BUỘC xóa hết các marker này khỏi content_latex sau khi xử lý — không bao giờ để sót nguyên văn "[IMAGE:...]" hay "\n" thừa trong nội dung hiển thị cho học sinh):
- "[IMAGE:tên_file]": thêm chuỗi tên_file đó (không có ngoặc) vào mảng "image_urls" của câu hỏi tương ứng. MỘT câu hỏi có thể có NHIỀU marker [IMAGE:...] liên tiếp (vd 2-3 hình minh họa cho cùng 1 câu) — khi đó thêm TẤT CẢ các tên_file đó vào "image_urls" theo đúng thứ tự xuất hiện, không được bỏ sót ảnh nào và không được để sót marker nào lại trong content_latex.
- "[CT?N]" (N là số): đây là công thức MathType cũ hệ thống chưa OCR được — GIỮ NGUYÊN marker này y hệt tại vị trí xuất hiện trong content_latex hoặc text_latex (không viết lại, không xóa, không mở rộng thành câu dài). Chỉ cần đặt raw_ocr_notes = "Có công thức cần giáo viên nhập tay (đánh dấu [CT?N] trong nội dung)." một lần duy nhất cho câu hỏi đó.

Chỉ trả về JSON hợp lệ, không markdown, không code fence.`;

const PDF_PAGE_PROMPT = `Bạn là trợ lý số hóa đề thi tiếng Việt. Đọc ảnh 1 TRANG đề thi đính kèm (chữ tiếng Việt có dấu, công thức toán, hình vẽ minh họa) và trả về DUY NHẤT 1 JSON theo schema:

{
  "title": "tên đề thi (chỉ điền nếu trang này là trang đầu có tiêu đề, còn lại để null)",
  "subject": "môn học (chỉ điền nếu trang này là trang đầu, còn lại để null)",
  "questions": [
    {
      "type": "multiple_choice" | "true_false_group" | "short_answer",
      "content_latex": "nội dung câu hỏi, công thức toán bọc trong $...$",
      "figure_refs": ["fig1"],
      "options": [{"key": "A", "text_latex": "..."}],
      "sub_statements": [{"key": "a", "text_latex": "...", "answer": true}],
      "correct_answer": "A hoặc null nếu trang này không có đáp án kèm theo",
      "short_answer_normalized": "đáp án hoặc null",
      "score_rule": "standard" | "thpt2025_truefalse_partial",
      "max_score": 0.25,
      "raw_ocr_notes": null
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
- "content_latex" CHỈ chứa phần dẫn đề dùng chung, TUYỆT ĐỐI KHÔNG chép lại các lựa chọn A/B/C/D hay mệnh đề a)/b)/c)/d) vào đó — những thứ đó CHỈ nằm trong "options"/"sub_statements", lặp cả 2 nơi sẽ hiện trùng lặp cho học sinh.
- "figures": BẮT BUỘC liệt kê MỌI hình vẽ/đồ thị/sơ đồ minh họa xuất hiện trên trang (hình học không gian, đồ thị hàm số, sơ đồ, bảng vẽ tay...) — KHÔNG liệt kê icon trang trí hay logo. Nếu câu hỏi nhắc "xem hình dưới/hình bên" thì trang CHẮC CHẮN có hình, TUYỆT ĐỐI không được bỏ sót hình đó chỉ vì không chắc chắn ranh giới chính xác — thà vẽ khung chưa hoàn hảo còn hơn không liệt kê gì cả. "bbox_1000" là toạ độ khung hình đó [x0,y0,x1,y1], chuẩn hoá theo thang 0-1000 trên cả 2 trục, (0,0) là góc trên-trái trang, (1000,1000) là góc dưới-phải trang.
  QUAN TRỌNG về độ chính xác khung cắt — ưu tiên KHÔNG BAO GIỜ cắt thiếu hình hơn là cắt đẹp:
  1. Xác định ranh giới hình vẽ bằng mắt, rồi NỚI RỘNG khung thêm một chút ra mọi phía (an toàn hơn là vừa khít) để chắc chắn không cắt mất nét vẽ, đường kẻ, hay nhãn đỉnh/điểm nằm sát rìa — thừa một chút nền trắng xung quanh hình là HOÀN TOÀN CHẤP NHẬN ĐƯỢC.
  2. Chỉ tránh để khung lấn vào DÒNG CHỮ của câu hỏi khác ở xa hình (đề bài, đáp án A/B/C/D) — nếu hình và chữ nằm sát nhau trong cùng 1 câu, ưu tiên lấy đủ hình hơn là cắt gọn, vì thiếu hình nghiêm trọng hơn nhiều so với dư vài chữ ở mép.
  3. Nếu 1 trang có nhiều hình riêng biệt (vd nhiều câu hỏi mỗi câu 1 hình), mỗi hình phải có khung RIÊNG, không gộp 2 hình liền kề vào 1 bbox.
- "figure_refs": mảng id các hình (từ "figures") thuộc về câu hỏi này, theo đúng thứ tự xuất hiện. Một câu có thể có 0, 1 hoặc nhiều hình. Để mảng rỗng [] nếu câu không có hình.
- Nếu có đáp án/lời giải trên trang này, dùng để điền đáp án đúng. Nếu không, để null, TUYỆT ĐỐI không bịa.
- Nếu trang có bảng số liệu, trình bày bằng cú pháp Markdown table trong content_latex (vd: "| Nhóm | [0;40) |\n| --- | --- |\n| Tần số | 11 |"). TUYỆT ĐỐI KHÔNG dùng \\begin{tabular}...\\end{tabular} — hệ thống không render được bảng LaTeX.
- Nếu đề liệt kê điều kiện bằng gạch đầu dòng "+"/"-"/"•" (vd "...thỏa mãn: + Điều kiện 1; + Điều kiện 2."), chèn ký tự xuống dòng thật "\n" trước MỖI gạch đầu dòng, không viết dính liền 1 đoạn.
{continuationRule}
Chỉ trả JSON hợp lệ, không markdown, không code fence.`;

const CONTINUATION_RULE_TEMPLATE = `
QUAN TRỌNG — câu hỏi bị cắt ngang trang: Dưới đây là phần cuối nội dung đã đọc được ở TRANG TRƯỚC, câu hỏi đó CHƯA kết thúc (bị cắt bởi lề trang):
---
{prevTail}
---
Trang hiện tại BẮT ĐẦU bằng phần TIẾP THEO của chính câu hỏi đó (có thể là phần mệnh đề a/b/c/d, phần lựa chọn A/B/C/D, hoặc đoạn văn còn lại). Với câu hỏi đầu tiên trên trang này:
1. Đặt content_latex BẮT ĐẦU bằng marker "[TIẾP TRANG TRƯỚC] " rồi mới đến nội dung PHẦN MỚI đọc được trên trang này (không lặp lại phần đã cho ở trên).
2. Xác định "type" dựa trên TOÀN BỘ câu hỏi (cả phần ở trang trước lẫn phần ở trang này) — vd nếu thấy đủ 4 mệnh đề a/b/c/d Đúng/Sai thì type phải là "true_false_group", không phải "multiple_choice".
3. Điền đầy đủ "options"/"sub_statements" cho câu đó dựa trên phần đọc được ở trang này.
Các câu hỏi KHÁC trên trang (không phải câu đầu tiên) xử lý bình thường, không thêm marker.
`;

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

/** Gọi Gemini generateContent với parts tuỳ ý, tự retry khi gặp lỗi tạm thời (429 hết
 * quota, 503 quá tải, hoặc timeout mạng) — đây là lỗi thoáng qua chứ không phải lỗi code.
 * Backoff tăng dần (2s/5s/10s, tổng ~17s chờ) để vượt qua các đợt Gemini quá tải ngắn hạn
 * (thực tế quan sát được "503 high demand" có thể kéo dài vài chục giây), vẫn nằm sâu
 * trong maxDuration của route (180s). */
const RETRY_BACKOFF_MS = [2000, 5000, 10000];

async function callGeminiRaw(model: string, parts: unknown[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Chưa cấu hình GEMINI_API_KEY");

  let lastError: Error | null = null;
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      if (!transient || attempt === maxAttempts - 1) throw lastError;
      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }
  throw lastError ?? new Error("Gemini: lỗi không xác định");
}

async function callGeminiText(prompt: string): Promise<string> {
  return callGeminiRaw(GEMINI_MODEL_TEXT, [{ text: prompt }]);
}

async function callGeminiWithImage(imageBase64: string, prompt: string, mimeType = "image/png"): Promise<string> {
  return callGeminiRaw(GEMINI_MODEL_VISION, [
    { inline_data: { mime_type: mimeType, data: imageBase64 } },
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

function provider(): "auto" | "gemini" | "deepseek" {
  const p = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  return p === "gemini" || p === "deepseek" ? p : "auto";
}
/**
 * Công thức MathType cũ trong docx được lưu dạng ảnh WMF (Windows Metafile) nhúng không thể
 * dùng LibreOffice để convert sang PNG trên Vercel serverless (không có binary) — đây là
 * giới hạn đã biết từ đầu dự án. Thư viện `emf-converter` (thuần JS, không cần binary
 * ngoài) decode WMF thành PNG trực tiếp trong Node — đã verify thực tế: vài ký hiệu đặc
 * biệt (ngoặc, dấu so sánh từ font Symbol cũ của Equation Editor 3.0) hiện thành ô vuông
 * trống do thiếu glyph, nhưng Gemini vision vẫn tự suy luận đúng ký hiệu từ ngữ cảnh
 * toán học (vd ô vuông giữa "P" và "B" được đọc đúng thành dấu ngoặc). Kết quả: thay
 * được nhiều marker [CT?N] bằng LaTeX thật thay vì để trống cho giáo viên tự nhập tay.
 */
const WMF_FORMULA_PROMPT = `Đây là 1 công thức toán được cắt ra từ ảnh công thức Word cũ (MathType/Equation Editor), có thể bị lỗi font hiện vài ký hiệu (ngoặc, dấu so sánh, ký hiệu Hy Lạp...) thành ô vuông trống hoặc ký tự lạ. Hãy đọc và viết lại thành LaTeX, TỰ SUY LUẬN ký hiệu đúng dựa vào ngữ cảnh toán học xung quanh (vd ô vuông giữa 2 biến thường là phép toán hoặc quan hệ như =, <, \\in, |...). Trả về DUY NHẤT 1 JSON theo schema: {"latex": "chuỗi LaTeX, không bao $...$"}.`;

/**
 * OCR hàng loạt các ảnh công thức WMF (từ nhánh LEGACY_OLE_IMAGE của docxExtract.ts) —
 * mỗi công thức là 1 lần gọi Gemini vision riêng (không ghép chung vì mỗi ảnh rất nhỏ,
 * ghép chung dễ lẫn lộn thứ tự). Chạy song song giới hạn (không tuần tự từng cái — đã
 * gặp thực tế 1 file có tới 129 công thức, chạy tuần tự sẽ mất vài phút và có nguy cơ
 * vượt maxDuration của route) nhưng giới hạn số lượng tối đa OCR để không nổ quota/thời
 * gian cho những file cực đoan nhiều công thức — công thức vưỡt cap hoặc OCR lỗi thì bỏ
 * qua (giữ nguyên marker [CT?N] làm lưới an toàn) thay vì làm hỏng cả lần upload.
 */
const WMF_OCR_CONCURRENCY = 5;
const WMF_OCR_MAX_COUNT = 60;

export async function ocrWmfEquations(equations: Map<number, Buffer>): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  let convertMetafileToDataUrl: (buf: ArrayBuffer) => Promise<string | null>;
  try {
    // import động để cô lập lỗi nếu môi trường serverless không load được binary native
    // của @napi-rs/canvas (Vercel Linux khác Windows local) — nếu lỗi, trả về rỗng và để
    // toàn bộ rơi về marker [CT?N] như cũ thay vì làm hỏng cả lần upload.
    ({ convertMetafileToDataUrl } = await import("emf-converter"));
  } catch (e) {
    console.error("[ocrWmfEquations] import emf-converter failed:", e);
    return results;
  }
  const entries = [...equations].slice(0, WMF_OCR_MAX_COUNT);

  async function ocrOne(num: number, wmfBuf: Buffer): Promise<void> {
    try {
      const arrayBuffer = wmfBuf.buffer.slice(wmfBuf.byteOffset, wmfBuf.byteOffset + wmfBuf.byteLength) as ArrayBuffer;
      const dataUrl = await convertMetafileToDataUrl(arrayBuffer);
      if (!dataUrl) { console.error(`[ocrWmfEquations] equation ${num}: convertMetafileToDataUrl returned null`); return; }
      const base64 = dataUrl.split(",")[1];
      const response = await callGeminiWithImage(base64, WMF_FORMULA_PROMPT);
      const parsed = extractJson(response) as { latex?: string };
      const cleaned = parsed.latex?.trim().replace(/^\$+|\$+$/g, "").trim();
      if (cleaned) results.set(num, cleaned);
    } catch (e) {
      console.error(`[ocrWmfEquations] equation ${num} failed:`, e);
      // bỏ qua, giữ nguyên marker [CT?N] cho công thức này
    }
  }

  for (let i = 0; i < entries.length; i += WMF_OCR_CONCURRENCY) {
    const batch = entries.slice(i, i + WMF_OCR_CONCURRENCY);
    await Promise.all(batch.map(([num, buf]) => ocrOne(num, buf)));
  }
  return results;
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

/**
 * Đáp án đọc được từ file đáp án RIÊNG (đề và đáp án là 2 file khác nhau, giáo viên upload
 * cả 2 — xem giải thích luồng upload mới trong route extract-upload). "question_number" là
 * số thứ tự câu hỏi NHƯ TRONG FILE ĐÁP ÁN (1, 2, 3...), dùng để ghép với câu hỏi đã trích
 * xuất từ file đề theo đúng order_index (question_number - 1), giả định đề đánh số tuần tự.
 */
export interface AnswerKeyEntry {
  question_number: number;
  type: "multiple_choice" | "true_false_group" | "short_answer";
  correct_answer?: string | null;
  sub_statements?: { key: string; answer: boolean }[];
  value?: string | null;
}

const ANSWER_KEY_PROMPT = `Bạn là trợ lý đọc đáp án đề thi tiếng Việt. Nội dung/ảnh đính kèm là FILE ĐÁP ÁN (không phải đề thi) — có thể là bảng đáp án ngắn gọn (vd "1-A 2-C 3-D...", hoặc bảng Đúng/Sai từng ý a/b/c/d) hoặc lời giải chi tiết từng câu. Đọc và trả về DUY NHẤT 1 JSON theo schema:
{
  "answers": [
    {"question_number": 1, "type": "multiple_choice", "correct_answer": "A"},
    {"question_number": 13, "type": "true_false_group", "sub_statements": [{"key": "a", "answer": true}, {"key": "b", "answer": false}, {"key": "c", "answer": true}, {"key": "d", "answer": false}]},
    {"question_number": 17, "type": "short_answer", "value": "145"}
  ]
}
Quy tắc:
- "question_number": số thứ tự câu hỏi đúng như trong file đáp án (đếm liên tục 1, 2, 3... theo thứ tự xuất hiện, không reset theo từng phần).
- Trắc nghiệm A/B/C/D: type "multiple_choice", "correct_answer" là 1 chữ cái in hoa.
- Đúng/Sai 4 ý a/b/c/d: type "true_false_group", "sub_statements" PHẢI đủ 4 phần tử đúng thứ tự a,b,c,d.
- Tự luận/điền số: type "short_answer", "value" là đáp án dạng chuỗi (giữ nguyên định dạng số, vd "12.5" hoặc "1234").
- Nếu không đọc được đáp án của một câu nào đó, bỏ qua câu đó hoàn toàn (không bịa đáp án).
Chỉ trả JSON hợp lệ, không markdown, không code fence.`;

function parseAnswerKeyResponse(text: string): AnswerKeyEntry[] {
  const data = extractJson(text) as { answers?: AnswerKeyEntry[] };
  return data.answers ?? [];
}

/** Đọc đáp án từ nội dung text thuần (file đáp án dạng .docx) — 1 lần gọi Gemini duy nhất. */
export async function extractAnswerKeyFromText(rawText: string): Promise<AnswerKeyEntry[]> {
  const prompt = ANSWER_KEY_PROMPT + "\n\nNội dung file đáp án:\n---\n" + rawText + "\n---";
  return parseAnswerKeyResponse(await callGeminiText(prompt));
}

/** Đọc đáp án từ 1 ảnh (file đáp án dạng ảnh chụp, hoặc từng trang PDF đã render) — 1 lần
 * gọi Gemini vision / ảnh. */
export async function extractAnswerKeyFromImage(imageBase64: string, mimeType = "image/png"): Promise<AnswerKeyEntry[]> {
  return parseAnswerKeyResponse(await callGeminiWithImage(imageBase64, ANSWER_KEY_PROMPT, mimeType));
}

/** File đáp án dạng PDF nhiều trang — render từng trang rồi gọi Gemini vision riêng cho mỗi
 * trang (giống extractPdfPages nhưng không cần OCR câu hỏi/hình ảnh, chỉ cần đáp án nên
 * không dùng ngữ cảnh nối trang). Số lần gọi Gemini = số trang PDF đáp án. */
export async function extractAnswerKeyFromPdf(buffer: Buffer): Promise<AnswerKeyEntry[]> {
  const { renderPdfPages } = await import("./pdfRender");
  const pages = renderPdfPages(buffer);
  const all: AnswerKeyEntry[] = [];
  for (const page of pages) {
    const entries = await extractAnswerKeyFromImage(page.toString("base64"));
    all.push(...entries);
  }
  return all;
}

/**
 * Ghép đáp án đọc được từ file đáp án riêng vào danh sách câu hỏi đã trích xuất từ file đề
 * — match theo question_number (1-based trong file đáp án) với order_index (0-based) của
 * câu hỏi. Câu nào không có đáp án khớp thì giữ nguyên null/false mặc định (giáo viên tự
 * điền tay ở bước duyệt). KHÔNG gọi thêm Gemini — chỉ là object merge thuần JS.
 */
export function mergeAnswerKeyIntoQuestions(
  questions: ExtractedExam["questions"],
  answerKey: AnswerKeyEntry[]
): ExtractedExam["questions"] {
  const byNumber = new Map(answerKey.map((a) => [a.question_number, a]));
  return questions.map((q, idx) => {
    const entry = byNumber.get(idx + 1);
    if (!entry) return q;
    if (q.type === "multiple_choice" && entry.correct_answer) {
      return { ...q, correct_answer: entry.correct_answer };
    }
    if (q.type === "true_false_group" && entry.sub_statements?.length) {
      const answerByKey = new Map(entry.sub_statements.map((s) => [s.key, s.answer]));
      return {
        ...q,
        sub_statements: q.sub_statements.map((s) => ({
          ...s,
          answer: answerByKey.has(s.key) ? answerByKey.get(s.key)! : s.answer,
        })),
      };
    }
    if (q.type === "short_answer" && entry.value) {
      return { ...q, short_answer_normalized: entry.value };
    }
    return q;
  });
}

interface PdfPageResult {
  title: string | null;
  subject: string | null;
  questions: Array<Record<string, unknown> & { figure_refs?: string[] }>;
  figures: Array<{ id: string; bbox_1000: [number, number, number, number] }>;
}

async function ocrPdfPage(pagePngBase64: string, prevTail: string | null): Promise<PdfPageResult> {
  if (provider() === "deepseek") {
    throw new Error("DeepSeek chưa hỗ trợ nhận ảnh trong pipeline này — dùng Gemini cho nhánh PDF.");
  }
  const continuationRule = prevTail
    ? CONTINUATION_RULE_TEMPLATE.replace("{prevTail}", prevTail)
    : "";
  const prompt = PDF_PAGE_PROMPT.replace("{continuationRule}", continuationRule);
  const text = await callGeminiWithImage(pagePngBase64, prompt);
  return extractJson(text) as PdfPageResult;
}

const CONTINUATION_MARKER = "[TIẾP TRANG TRƯỚC]";

/** Tóm tắt ngắn gọn 1 câu hỏi (nội dung + mệnh đề/lựa chọn) để làm "ngữ cảnh cuối trang"
 * truyền sang lần gọi Gemini cho trang kế tiếp — giúp model nhận ra câu hỏi bị cắt trang
 * thay vì coi là 2 câu độc lập (đã quan sát thực tế: 1 câu true_false_group bị cắt làm
 * đôi thành 1 câu multiple_choice rỗng + 1 câu true_false_group thiếu phần mở đầu). */
function summarizeQuestionTail(q: Record<string, unknown>, maxLen = 220): string {
  const parts = [String(q.content_latex ?? "")];
  for (const s of (q.sub_statements as Array<{ text_latex?: string }>) ?? []) {
    if (s.text_latex) parts.push(s.text_latex);
  }
  for (const o of (q.options as Array<{ text_latex?: string }>) ?? []) {
    if (o.text_latex) parts.push(o.text_latex);
  }
  const full = parts.join(" ");
  return full.length > maxLen ? full.slice(-maxLen) : full;
}

/**
 * Xử lý PDF theo từng trang: render trang -> ảnh PNG (pdfRender.ts) -> Gemini vision đọc
 * nội dung + xác định bbox hình vẽ -> cắt ảnh bằng sharp -> gộp lại thành 1 ExtractedExam
 * với image_urls trỏ tới tên file cục bộ (giống hệt quy ước của nhánh docx, extract-upload
 * route sẽ upload các ảnh này lên Storage theo cùng 1 logic cho cả 2 nhánh).
 */
export async function extractPdfPages(
  pdfBuffer: Buffer
): Promise<{ extracted: ExtractedExam; images: Map<string, Buffer> }> {
  const { renderPdfPages } = await import("./pdfRender");
  return extractImagePages(renderPdfPages(pdfBuffer, 200));
}

/** Đề thi dạng 1 ảnh chụp duy nhất (jpg/png) — xử lý như PDF 1 trang, dùng chung pipeline
 * OCR + crop hình với extractPdfPages. */
export async function extractExamFromImage(
  imageBuffer: Buffer
): Promise<{ extracted: ExtractedExam; images: Map<string, Buffer> }> {
  return extractImagePages([imageBuffer]);
}

async function extractImagePages(
  pagePngs: Buffer[]
): Promise<{ extracted: ExtractedExam; images: Map<string, Buffer> }> {
  const sharp = (await import("sharp")).default;

  const images = new Map<string, Buffer>();
  const allQuestions: ExtractedExam["questions"] = [];
  let title: string | null = null;
  let subject: string | null = null;
  let prevTail: string | null = null;

  for (let pageIndex = 0; pageIndex < pagePngs.length; pageIndex++) {
    const pagePng = pagePngs[pageIndex];
    const { width, height } = await sharp(pagePng).metadata();

    let result: PdfPageResult;
    try {
      result = await ocrPdfPage(pagePng.toString("base64"), prevTail);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (prevTail && msg.includes("RECITATION")) {
        // Gemini đôi khi từ chối sinh nội dung (finishReason RECITATION, nghi ngờ trùng lặp
        // bản quyền) khi prompt chứa nguyên văn trích dẫn dài từ trang trước làm ngữ cảnh —
        // thử lại KHÔNG kèm ngữ cảnh thay vì để cả lần upload lỗi; mất lợi ích ghép câu bị
        // cắt trang cho đúng 1 trang này, nhưng vẫn ra được kết quả thay vì lỗi 500.
        result = await ocrPdfPage(pagePng.toString("base64"), null);
      } else {
        throw e;
      }
    }
    if (pageIndex === 0) {
      title = result.title ?? title;
      subject = result.subject ?? subject;
    }

    const figureFilenames = new Map<string, string>();
    for (const fig of result.figures ?? []) {
      if (!width || !height) continue;
      const bbox = fig.bbox_1000;
      // LLM đôi khi trả bbox thiếu/sai định dạng (không đủ 4 số, hoặc không phải số) — bỏ
      // qua hình đó thay vì để sharp crash cả lần upload vì 1 toạ độ hỏng.
      if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
        continue;
      }
      // Nới khung thêm 3% bề rộng/cao mỗi cạnh làm lưới an toàn — không phụ thuộc hoàn
      // toàn vào việc Gemini vẽ khung chính xác tuyệt đối. Quan sát thực tế: khung sát y
      // nguyên theo LLM trả về đôi khi cắt mất nhãn đỉnh/điểm ở rìa hình; dư thêm vài %
      // nền trắng xung quanh ít gây hại hơn nhiều so với cắt thiếu.
      const MARGIN = 0.03;
      const [rawX0, rawY0, rawX1, rawY1] = bbox;
      const x0 = Math.max(0, rawX0 - (rawX1 - rawX0) * MARGIN);
      const y0 = Math.max(0, rawY0 - (rawY1 - rawY0) * MARGIN);
      const x1 = Math.min(1000, rawX1 + (rawX1 - rawX0) * MARGIN);
      const y1 = Math.min(1000, rawY1 + (rawY1 - rawY0) * MARGIN);
      const left = Math.max(0, Math.round((x0 / 1000) * width));
      const top = Math.max(0, Math.round((y0 / 1000) * height));
      const cropWidth = Math.min(width - left, Math.round(((x1 - x0) / 1000) * width));
      const cropHeight = Math.min(height - top, Math.round(((y1 - y0) / 1000) * height));
      if (cropWidth <= 0 || cropHeight <= 0) continue;

      const filename = `page${pageIndex + 1}_${fig.id}.png`;
      const cropped = await sharp(pagePng)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .png()
        .toBuffer();
      images.set(filename, cropped);
      figureFilenames.set(fig.id, filename);
    }

    const pageQuestions = result.questions ?? [];
    for (let qi = 0; qi < pageQuestions.length; qi++) {
      const q = pageQuestions[qi];
      const imageUrls = (q.figure_refs ?? [])
        .map((id) => figureFilenames.get(id))
        .filter((f): f is string => Boolean(f));
      const contentStr = String(q.content_latex ?? "");

      if (qi === 0 && contentStr.startsWith(CONTINUATION_MARKER) && allQuestions.length > 0) {
        // Câu đầu trang này là phần tiếp của câu cuối trang trước — ghép lại thành 1 câu,
        // không push thêm entry mới. Ưu tiên type/sub_statements/options của lần đọc này
        // (sau khi đã thấy đủ nội dung) vì trang trước có thể đã đoán sai type do thiếu
        // thông tin (vd đoán multiple_choice vì chưa thấy mệnh đề a/b/c/d).
        const prev = allQuestions[allQuestions.length - 1] as unknown as Record<string, unknown>;
        const mergedContent = `${String(prev.content_latex ?? "")} ${contentStr.slice(CONTINUATION_MARKER.length).trim()}`.trim();
        allQuestions[allQuestions.length - 1] = {
          ...prev,
          ...q,
          content_latex: mergedContent,
          image_urls: [...((prev.image_urls as string[]) ?? []), ...imageUrls],
        } as ExtractedExam["questions"][number];
      } else {
        allQuestions.push({ ...q, image_urls: imageUrls } as ExtractedExam["questions"][number]);
      }
    }

    if (pageQuestions.length > 0) {
      prevTail = summarizeQuestionTail(pageQuestions[pageQuestions.length - 1]);
    }
  }

  return {
    extracted: { title: title ?? "", subject: subject ?? "", source_branch: "PDF_IMAGE_ONLY", questions: allQuestions },
    images,
  };
}
