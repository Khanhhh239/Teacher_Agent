import { Agent, fetch as undiciFetch } from "undici";
import type { ExtractedExam } from "@/types/exam";
import { createAdminClient } from "@/lib/supabase/admin";
import { waitForSlot } from "./rateLimiter";

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

QUAN TRỌNG — KHÔNG được gộp nhiều câu hỏi làm một: văn bản gốc đánh số mỗi câu bằng "Câu N:" (hoặc "Câu N.") — MỖI lần xuất hiện "Câu N:" PHẢI tạo ra ĐÚNG 1 object riêng trong mảng "questions", kể cả khi nội dung câu đó dài, phức tạp, hoặc nằm sát ngay sau câu trước không có dòng trống phân cách. TUYỆT ĐỐI KHÔNG được dồn nội dung của 2+ câu khác nhau vào chung 1 "content_latex" — nếu thấy nhiều cụm "Câu N:" liên tiếp trong văn bản, PHẢI trả về đúng số lượng object tương ứng, không được bỏ sót hay gộp bất kỳ câu nào, kể cả các câu ở cuối văn bản.

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
- "figure_refs": mảng id các hình (từ "figures") thuộc về câu hỏi này, theo đúng thứ tự xuất hiện. Một câu có thể có 0, 1 hoặc nhiều hình. Để mảng rỗng [] nếu câu không có hình. QUAN TRỌNG: chỉ gán 1 hình vào figure_refs của 1 câu DUY NHẤT — hình đó phải NẰM GẦN và THUỘC VỀ đúng câu đó theo vị trí trên trang. TUYỆT ĐỐI KHÔNG được gán nhiều hình không liên quan (vd hình của câu khác, hình trang trí ở đầu/cuối trang) dồn hết vào figure_refs của 1 câu chỉ vì không chắc hình đó thuộc câu nào — nếu không chắc 1 hình thuộc câu nào, để hình đó trong "figures" nhưng KHÔNG thêm vào figure_refs của câu nào cả, còn hơn gán nhầm.
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

export function extractJson(text: string): unknown {
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

/**
 * Giới hạn số lượt gọi Gemini ĐANG CHẠY cùng lúc trên toàn hệ thống (không riêng 1 request)
 * — tránh trường hợp nhiều giáo viên upload đề cùng lúc dồn dập vượt hạn mức RPM free tier
 * gây lỗi 429/503 hàng loạt cho tất cả mọi người. Dùng 1 bảng Postgres làm "vé" (slot) có
 * hạn dùng (expires_at) thay vì state trong bộ nhớ, vì Vercel serverless không đảm bảo các
 * lượt gọi khác nhau chạy chung 1 instance. Bảng tự dọn slot hết hạn ở mỗi lần acquire, nên
 * không cần cron riêng — xem migration 0006_llm_slots_and_preview.sql.
 */
const MAX_CONCURRENT_GEMINI_CALLS = 4;
const SLOT_TTL_MS = 30_000;
const SLOT_WAIT_ATTEMPTS = 8;
const SLOT_WAIT_MS = 2500;
const OVERLOAD_WARNING = "Hệ thống đang xử lý nhiều đề cùng lúc, lượt xử lý này có thể chậm hơn bình thường.";

async function acquireGeminiSlot(warnings?: string[]): Promise<string | null> {
  const admin = createAdminClient();
  try {
    for (let attempt = 0; attempt < SLOT_WAIT_ATTEMPTS; attempt++) {
      const { error: countError, count } = await admin
        .from("llm_call_slots")
        .select("id", { count: "exact", head: true });
      // Bảng llm_call_slots chưa tồn tại (vd migration chưa chạy) hoặc lỗi DB khác — không
      // được để việc này chặn cả lần upload, coi như không giới hạn (fail-open).
      if (countError) return null;
      if ((count ?? 0) < MAX_CONCURRENT_GEMINI_CALLS) {
        const { data, error } = await admin
          .from("llm_call_slots")
          .insert({ expires_at: new Date(Date.now() + SLOT_TTL_MS).toISOString() })
          .select("id")
          .single();
        if (!error && data) return data.id as string;
        if (error) return null;
      }
      await admin.from("llm_call_slots").delete().lt("expires_at", new Date().toISOString());
      if (attempt === 0 && warnings && !warnings.includes(OVERLOAD_WARNING)) {
        warnings.push(OVERLOAD_WARNING);
      }
      await sleep(SLOT_WAIT_MS);
    }
    // Hết lượt chờ vẫn không có slot trống — không chặn hẳn người dùng (thà xử lý chậm/chịu
    // rủi ro 429 còn hơn báo lỗi luôn), chỉ đảm bảo cảnh báo đã được ghi nhận.
    if (warnings && !warnings.includes(OVERLOAD_WARNING)) warnings.push(OVERLOAD_WARNING);
    return null;
  } catch {
    // Lỗi mạng/DB bất ngờ — fail-open, không chặn upload vì 1 tính năng phụ trợ.
    return null;
  }
}

async function releaseGeminiSlot(slotId: string | null): Promise<void> {
  if (!slotId) return;
  try {
    await createAdminClient().from("llm_call_slots").delete().eq("id", slotId);
  } catch {
    // Không xoá được thì slot tự hết hạn sau SLOT_TTL_MS — không chặn luồng chính vì việc này.
  }
}

/** Gọi Gemini generateContent với parts tuỳ ý, tự retry khi gặp lỗi tạm thời (429 hết
 * quota, 503 quá tải, hoặc timeout mạng) — đây là lỗi thoáng qua chứ không phải lỗi code.
 * Backoff tăng dần (2s/5s/10s, tổng ~17s chờ) để vượt qua các đợt Gemini quá tải ngắn hạn
 * (thực tế quan sát được "503 high demand" có thể kéo dài vài chục giây), vẫn nằm sâu
 * trong maxDuration của route (180s). Giữ 1 "slot" (xem acquireGeminiSlot) trong suốt các
 * lần thử, không riêng từng lần, vì đây vẫn là 1 lượt gọi logic duy nhất. */
const RETRY_BACKOFF_MS = [2000, 5000, 10000];

async function callGeminiRaw(model: string, parts: unknown[], warnings?: string[], temperature = 0): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Chưa cấu hình GEMINI_API_KEY");

  const slotId = await acquireGeminiSlot(warnings);
  try {
    let lastError: Error | null = null;
    let quotaWaitedMs = 0;
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
              generationConfig: { temperature, responseMimeType: "application/json" },
            }),
            dispatcher: longTimeoutDispatcher,
          }
        );
        const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!res.ok) {
          const err = new Error(`Gemini lỗi ${res.status}: ${JSON.stringify(data).slice(0, 300)}`) as Error & { retryAfterMs?: number };
          console.warn(JSON.stringify({ event: "gemini_call_failed", model, status: res.status, attempt: attempt + 1, retryAfterMs: (err as Error & { retryAfterMs?: number }).retryAfterMs ?? null }));
          // Lỗi 429 của Gemini kèm RetryInfo.retryDelay (vd "23s") = thời gian Google yêu cầu
          // chờ để hạn mức theo phút được làm mới — chờ đúng khoảng đó hiệu quả hơn hẳn chờ
          // cứng 2s/5s/10s (quá ngắn, thử lại vẫn 429 rồi bỏ cuộc).
          const details: Array<Record<string, unknown>> = data?.error?.details ?? [];
          const retryInfo = details.find((d) => String(d["@type"] ?? "").includes("RetryInfo"));
          const secs = parseFloat(String(retryInfo?.retryDelay ?? ""));
          if (res.status === 429 && Number.isFinite(secs)) err.retryAfterMs = Math.ceil(secs * 1000);
          throw err;
        }
        const finishReason = data?.candidates?.[0]?.finishReason;
        if (finishReason === "RECITATION") {
          // Thông báo gốc của Gemini dài và lẫn JSON thô, không thân thiện — giữ nguyên từ
          // khoá "RECITATION" để các lớp gọi retry (ocrPdfPageWithRecitationRetry,
          // extractAnswerKeyFromImage) vẫn nhận diện được, nhưng phần hiển thị cho người
          // dùng ngắn gọn, dễ hiểu hơn.
          throw new Error("RECITATION: Gemini từ chối đọc nội dung trang này vì nghi ngờ trùng khớp tài liệu có bản quyền đã biết (thường gặp với đề thi chính thức đã được đăng tải công khai).");
        }
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Gemini không trả về nội dung: " + JSON.stringify(data).slice(0, 300));
        return text;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const transient = isTransientError(lastError.message);
        if (!transient || attempt === maxAttempts - 1) {
          console.error(JSON.stringify({ event: "gemini_call_exhausted", model, attempts: attempt + 1, error: lastError.message.slice(0, 1000) }));
          throw lastError;
        }
        const retryWarning = "Gemini phản hồi chậm/quá tải tạm thời, hệ thống đã tự thử lại.";
        if (warnings && !warnings.includes(retryWarning)) warnings.push(retryWarning);
        const retryAfterMs = (lastError as Error & { retryAfterMs?: number }).retryAfterMs;
        // Chờ đúng thời gian Google yêu cầu (+1s đệm), tối đa 45s/lần và tổng cộng không quá
        // ~100s mỗi lệnh gọi để còn nằm trong maxDuration của route; nếu quá ngân sách thì bỏ
        // cuộc luôn thay vì ngủ vô ích.
        if (retryAfterMs !== undefined) {
          const wait = Math.min(retryAfterMs + 1000, 45_000);
          if (quotaWaitedMs + wait > 100_000) throw lastError;
          quotaWaitedMs += wait;
          await sleep(wait);
        } else {
          await sleep(RETRY_BACKOFF_MS[attempt]);
        }
      }
    }
    throw lastError ?? new Error("Gemini: lỗi không xác định");
  } finally {
    await releaseGeminiSlot(slotId);
  }
}

async function callGeminiText(prompt: string, warnings?: string[]): Promise<string> {
  return callGeminiRaw(GEMINI_MODEL_TEXT, [{ text: prompt }], warnings);
}

export async function callGeminiWithImage(
  imageBase64: string,
  prompt: string,
  mimeType = "image/png",
  warnings?: string[],
  temperature = 0,
  model: string = GEMINI_MODEL_VISION
): Promise<string> {
  return callGeminiRaw(
    model,
    [
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
      { text: prompt },
    ],
    warnings,
    temperature
  );
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

// Model vision miễn phí qua OpenRouter (không tính phí: pricing.prompt=0, completion=0 — xác
// nhận trực tiếp qua https://openrouter.ai/api/v1/models lúc chọn model này) — dùng làm
// phương án CUỐI CÙNG khi Gemini bị chặn RECITATION ngay cả sau khi đã tách đôi trang (xem
// callVisionFallback). Không dùng làm pipeline chính vì free tier OpenRouter rất hẹp (50
// request/ngày nếu chưa nạp tiền), chỉ hợp để xử lý số ít trang bị kẹt, không phải cả đề.
const OPENROUTER_FALLBACK_VISION_MODEL = "qwen/qwen3.8-27b:free";

async function callOpenRouterVision(imageBase64: string, prompt: string, mimeType = "image/png"): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Chưa cấu hình OPENROUTER_API_KEY");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENROUTER_FALLBACK_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      temperature: 0,
      // Model này mặc định bật chế độ "suy nghĩ" (reasoning) khá dài dòng — tắt đi để chỉ
      // lấy JSON kết quả, tránh lẫn nội dung suy luận vào response và chậm không cần thiết.
      reasoning: { enabled: false },
      response_format: { type: "json_object" },
    }),
  });
  const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) throw new Error(`OpenRouter lỗi ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter không trả về nội dung: " + JSON.stringify(data).slice(0, 300));
  return text;
}

/**
 * Phương án cuối cùng khi Gemini bị RECITATION chặn 1 trang/nửa trang ngay cả sau khi đã thử
 * tách đôi (xem processPageImage/extractAnswerKeyFromPageWithSplit) — Qwen (qua OpenRouter)
 * không có bộ lọc recitation kiểu Gemini nên không gặp vấn đề này, dù độ chính xác OCR công
 * thức/tiếng Việt chưa chắc bằng Gemini. Không cấu hình OPENROUTER_API_KEY thì bỏ qua fallback
 * này, giữ hành vi cũ (bỏ trang, cảnh báo giáo viên tự nhập tay).
 */
async function callVisionFallback(imageBase64: string, prompt: string, warnings?: string[]): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    const text = await callOpenRouterVision(imageBase64, prompt, "image/png");
    warnings?.push("Gemini bị chặn (nghi bản quyền), hệ thống đã tự chuyển sang model dự phòng (Qwen) để đọc phần này — độ chính xác có thể thấp hơn bình thường, nên kiểm tra kỹ lại.");
    return text;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    warnings?.push(`Thử model dự phòng (Qwen) cũng thất bại: ${message}`);
    return null;
  }
}

function provider(): "auto" | "gemini" | "deepseek" {
  const p = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  return p === "gemini" || p === "deepseek" ? p : "auto";
}
/** Đếm số "Câu N:"/"Câu N." xuất hiện trong văn bản gốc — dùng để phát hiện trường hợp LLM
 * gộp nhầm 2+ câu vào 1 object (quan sát thực tế: các câu cuối văn bản dài đôi khi bị dồn
 * chung). Không chính xác tuyệt đối (số đếm thô theo regex) nhưng đủ để cảnh báo giáo viên
 * kiểm tra kỹ nếu lệch nhiều. */
const QUESTION_NUMBER_MARKER = /C[aâ]u\s*\d+\s*[:.]/gi;
function countQuestionMarkers(text: string): number {
  return (text.match(QUESTION_NUMBER_MARKER) ?? []).length;
}

export async function structureExamText(rawText: string, warnings?: string[]): Promise<ExtractedExam> {
  const prompt = STRUCTURE_PROMPT + "\n\nNội dung đề thi cần cấu trúc hóa:\n---\n" + rawText + "\n---";
  const p = provider();

  let result: ExtractedExam;
  if (p === "deepseek") {
    result = extractJson(await callDeepseekText(prompt)) as ExtractedExam;
  } else if (p === "gemini") {
    result = extractJson(await callGeminiText(prompt, warnings)) as ExtractedExam;
  } else {
    try {
      result = extractJson(await callGeminiText(prompt, warnings)) as ExtractedExam;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (process.env.DEEPSEEK_API_KEY && (isTransientError(msg) || !process.env.GEMINI_API_KEY)) {
        result = extractJson(await callDeepseekText(prompt)) as ExtractedExam;
      } else {
        throw e;
      }
    }
  }

  const expectedCount = countQuestionMarkers(rawText);
  if (warnings && expectedCount > 0 && result.questions.length < expectedCount) {
    warnings.push(
      `Phát hiện ${expectedCount} "Câu N:" trong văn bản gốc nhưng chỉ tách được ${result.questions.length} câu hỏi — có thể một vài câu bị gộp nhầm vào nhau, giáo viên nên kiểm tra kỹ các câu cuối đề.`
    );
  }
  return result;
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

/**
 * `pageQuestionHint`: với file đáp án PDF nhiều trang, mỗi trang được gọi Gemini RIÊNG LẺ
 * (không có ngữ cảnh trang khác — xem buildAnswerKeyPageHints). Khi lời giải 1 câu dài tràn
 * qua 2-3 trang, trang sau chỉ còn thấy phần "Lời giải" tiếp theo mà KHÔNG còn thấy lại nhãn
 * "Câu N:" (đã in ở trang trước đó) — model không có cách nào tự biết đúng số câu, nên hay
 * đoán nhầm (đã kiểm chứng thực tế: đoán thành "Câu 1" dù đang đọc lời giải của Câu 4 Phần II).
 * Thay vì để model tự đoán, ta TÍNH TRƯỚC bằng lớp chữ PDF (code thuần, không AI) đúng (các)
 * số thứ tự toàn cục mà trang này CHẮC CHẮN thuộc về, rồi ép model chỉ được dùng đúng số đó.
 */
function answerKeyPrompt(pageQuestionHint?: string): string {
  const hintBlock = pageQuestionHint
    ? `\n\nGỢI Ý BẮT BUỘC: trang này chỉ chứa nội dung của (các) câu theo ĐÚNG số thứ tự toàn cục sau, theo thứ tự xuất hiện trên trang: ${pageQuestionHint}. Nếu đọc được đáp án nào trên trang, PHẢI dùng "question_number" lấy từ đúng danh sách này (không tự đặt số khác, kể cả khi trang không còn thấy nhãn "Câu N:" vì lời giải tràn từ trang trước sang) — nếu trang không có đáp án nào khớp các câu trên, trả answers rỗng.`
    : "";
  return `Bạn là trợ lý đọc đáp án đề thi tiếng Việt. Nội dung/ảnh đính kèm là FILE ĐÁP ÁN (không phải đề thi) — có thể là bảng đáp án ngắn gọn (vd "1-A 2-C 3-D...", hoặc bảng Đúng/Sai từng ý a/b/c/d) hoặc lời giải chi tiết từng câu. Đọc và trả về DUY NHẤT 1 JSON theo schema:
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
Chỉ trả JSON hợp lệ, không markdown, không code fence.${hintBlock}`;
}

function parseAnswerKeyResponse(text: string): AnswerKeyEntry[] {
  const data = extractJson(text) as { answers?: AnswerKeyEntry[] };
  return data.answers ?? [];
}

/** Đọc đáp án từ nội dung text thuần (file đáp án dạng .docx) — 1 lần gọi Gemini duy nhất. */
export async function extractAnswerKeyFromText(rawText: string, warnings?: string[]): Promise<AnswerKeyEntry[]> {
  const prompt = answerKeyPrompt() + "\n\nNội dung file đáp án:\n---\n" + rawText + "\n---";
  return parseAnswerKeyResponse(await callGeminiText(prompt, warnings));
}

/** Đọc đáp án từ 1 ảnh (file đáp án dạng ảnh chụp, hoặc từng trang PDF đã render) — 1 lần
 * gọi Gemini vision / ảnh. Không retry nhiều temperature khi gặp RECITATION — đã kiểm chứng
 * thực tế là vô ích (xem ghi chú tại ocrPdfPageWithRecitationRetry), chỉ tốn lệnh gọi và dễ
 * vượt rate limit. Việc tách đôi trang khi gặp RECITATION do extractAnswerKeyFromPageWithSplit
 * đảm nhiệm ở lớp gọi. */
export async function extractAnswerKeyFromImage(
  imageBase64: string,
  mimeType = "image/png",
  warnings?: string[],
  model: string = GEMINI_MODEL_VISION,
  deadline?: number,
  questionNumberHint?: string
): Promise<AnswerKeyEntry[]> {
  // Giãn nhịp theo hạn mức free từng model để không dồn dập vào cùng lúc với phần đọc đề.
  // Nếu lượt gọi sẽ rơi sau deadline, bỏ qua luôn thay vì chờ rồi vẫn bị Vercel cắt request.
  const gotSlot = await waitForSlot(model, deadline);
  if (!gotSlot) {
    const msg = "Hết thời gian xử lý nên một số trang của file đáp án chưa đọc được — giáo viên tự điền các đáp án còn thiếu (gợi ý: upload ảnh bảng đáp án thay vì file lời giải dài).";
    if (warnings && !warnings.includes(msg)) warnings.push(msg);
    return [];
  }
  return parseAnswerKeyResponse(await callGeminiWithImage(imageBase64, answerKeyPrompt(questionNumberHint), mimeType, warnings, 0, model));
}

/** File đáp án dạng PDF nhiều trang — render từng trang rồi gọi Gemini vision riêng cho mỗi
 * trang (giống extractPdfPages nhưng không cần OCR câu hỏi/hình ảnh, chỉ cần đáp án nên
 * không dùng ngữ cảnh nối trang). Số lần gọi Gemini = số trang PDF đáp án. */
/** Đọc 1 trang/nửa trang đáp án, tự tách đôi (đã kiểm chứng tránh được RECITATION — xem
 * processPageImage trong extractImagePages) nếu bị từ chối, tối đa 1 lần tách. */
async function extractAnswerKeyFromPageWithSplit(
  pageBuffer: Buffer,
  pageLabel: string,
  warnings: string[] | undefined,
  depth: number,
  model: string = GEMINI_MODEL_VISION,
  deadline?: number,
  questionNumberHint?: string
): Promise<AnswerKeyEntry[]> {
  try {
    return await extractAnswerKeyFromImage(pageBuffer.toString("base64"), "image/png", warnings, model, deadline, questionNumberHint);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes("RECITATION")) throw e;
    if (depth >= 1) {
      const fallbackText = await callVisionFallback(pageBuffer.toString("base64"), answerKeyPrompt(questionNumberHint), warnings);
      if (fallbackText) {
        try {
          return parseAnswerKeyResponse(fallbackText);
        } catch {
          // JSON lỗi từ model dự phòng — coi như không đọc được, rơi về cảnh báo bên dưới.
        }
      }
      warnings?.push(`${pageLabel}: ${message} — đáp án các câu ở phần này sẽ bị thiếu, cần giáo viên tự điền tay.`);
      return [];
    }
    const sharp = (await import("sharp")).default;
    const { width, height } = await sharp(pageBuffer).metadata();
    if (!width || !height) {
      warnings?.push(`${pageLabel}: ${message} — đáp án các câu trên trang này sẽ bị thiếu, cần giáo viên tự điền tay.`);
      return [];
    }
    warnings?.push(`${pageLabel}: Gemini từ chối đọc do nghi ngờ bản quyền — hệ thống tự tách đôi trang để đọc riêng từng nửa.`);
    const topHeight = Math.round(height * 0.55);
    const bottomTop = Math.round(height * 0.45);
    const topHalf = await sharp(pageBuffer).extract({ left: 0, top: 0, width, height: topHeight }).png().toBuffer();
    const bottomHalf = await sharp(pageBuffer).extract({ left: 0, top: bottomTop, width, height: height - bottomTop }).png().toBuffer();
    const [topEntries, bottomEntries] = await Promise.all([
      extractAnswerKeyFromPageWithSplit(topHalf, `${pageLabel} (nửa trên)`, warnings, depth + 1, model, deadline, questionNumberHint),
      extractAnswerKeyFromPageWithSplit(bottomHalf, `${pageLabel} (nửa dưới)`, warnings, depth + 1, model, deadline, questionNumberHint),
    ]);
    return [...topEntries, ...bottomEntries];
  }
}

/**
 * Mỗi trang được gọi Gemini RIÊNG LẺ, không có ngữ cảnh các trang trước — nên khi file đáp án
 * đánh số lại "Câu 1" ở mỗi Phần (giống hệt file đề, rất phổ biến ở đề THPT 2025), AI KHÔNG
 * THỂ biết số thứ tự toàn cục thực sự là bao nhiêu (nó chỉ thấy đúng cái số in trên trang đó).
 * Hậu quả thực tế đã gặp: đáp án câu 1 của Phần III (số cục bộ "1") đè nhầm lên đáp án câu 1
 * của Phần I trong Map theo question_number, làm sai lệch hàng loạt câu.
 *
 * Sửa bằng cách dùng CHÍNH lớp chữ của file đáp án (nếu có, cùng thuật toán phân đoạn với file
 * đề — xem textLayerSegment.ts) để biết chắc chắn: trang P có những câu nào, số cục bộ bao
 * nhiêu, thuộc Phần nào → suy ra đúng vị trí toàn cục — hoàn toàn bằng code, không nhờ AI đếm.
 * Nếu file đáp án không có lớp chữ hợp lệ (ảnh chụp, hoặc không phân đoạn được) thì bỏ qua bước
 * này và giữ nguyên hành vi cũ (tin số AI trả về).
 */
interface AnswerKeyPageInfo {
  /** Chỉ các câu có NHÃN "Câu N:" bắt đầu trên trang này — khoá theo số cục bộ AI nhìn thấy. */
  localToGlobal: Map<number, number[]>;
  /** TẤT CẢ câu có bất kỳ phần nội dung/lời giải nào chạm tới trang này, kể cả khi lời giải
   * tràn từ trang trước sang (không còn thấy nhãn) — dùng làm gợi ý bắt buộc cho AI. */
  hint: string | undefined;
}

async function buildAnswerKeyPageInfo(buffer: Buffer): Promise<AnswerKeyPageInfo[] | null> {
  try {
    const { extractPageLines } = await import("./pdfTextLayer");
    const { segmentFromLines } = await import("./textLayerSegment");
    const pageLines = await extractPageLines(buffer);
    const seg = segmentFromLines(pageLines);
    if (!seg.ok) return null;
    const perPage: AnswerKeyPageInfo[] = Array.from({ length: pageLines.length }, () => ({
      localToGlobal: new Map(),
      hint: undefined,
    }));
    const hintNumbers: number[][] = Array.from({ length: pageLines.length }, () => []);
    seg.blocks.forEach((block, idx) => {
      const globalNumber = idx + 1;
      const labelPage = block.segments[0]?.page;
      if (labelPage !== undefined && perPage[labelPage]) {
        const queue = perPage[labelPage].localToGlobal.get(block.number) ?? [];
        queue.push(globalNumber);
        perPage[labelPage].localToGlobal.set(block.number, queue);
      }
      for (const page of new Set(block.segments.map((s) => s.page))) {
        if (hintNumbers[page] && !hintNumbers[page].includes(globalNumber)) hintNumbers[page].push(globalNumber);
      }
    });
    hintNumbers.forEach((nums, i) => {
      if (nums.length > 0) perPage[i].hint = nums.sort((a, b) => a - b).join(", ");
    });
    return perPage;
  } catch {
    return null;
  }
}

/** Ánh xạ "question_number" (số cục bộ AI đọc được trên 1 trang) sang số thứ tự toàn cục thật,
 * dùng thứ tự xuất hiện để phân biệt khi 1 trang có 2 câu trùng số cục bộ (hiếm, lúc Phần mới
 * bắt đầu giữa trang). Nếu không tìm thấy câu tương ứng trong lớp chữ, giữ nguyên số AI trả về
 * (an toàn hơn là làm mất hẳn câu trả lời đó). */
function remapToGlobalNumbers(entries: AnswerKeyEntry[], localToGlobal: Map<number, number[]> | undefined): AnswerKeyEntry[] {
  if (!localToGlobal) return entries;
  const consumed = new Map<number, number>();
  return entries.map((e) => {
    const queue = localToGlobal.get(e.question_number);
    if (!queue) return e;
    const usedCount = consumed.get(e.question_number) ?? 0;
    consumed.set(e.question_number, usedCount + 1);
    const globalNumber = queue[usedCount];
    return globalNumber === undefined ? e : { ...e, question_number: globalNumber };
  });
}

export async function extractAnswerKeyFromPdf(
  buffer: Buffer,
  warnings?: string[],
  opts: { model?: string; deadline?: number } = {}
): Promise<AnswerKeyEntry[]> {
  const { renderPdfPages } = await import("./pdfRender");
  const pages = renderPdfPages(buffer);
  const pageInfo = await buildAnswerKeyPageInfo(buffer);

  // Gọi TẤT CẢ các trang song song (rateLimiter.waitForSlot tự giãn nhịp an toàn giữa các lệnh
  // gọi đồng thời) thay vì tuần tự từng trang — với file đáp án nhiều trang (lời giải chi tiết),
  // chờ tuần tự từng round-trip mạng dễ làm hết ngân sách thời gian trước khi đọc xong mọi trang
  // (đã gặp thực tế: 15 trang tuần tự chỉ đọc được ~10/22 câu trước khi tới deadline).
  const perPageResults = await Promise.all(
    pages.map((page, i) =>
      extractAnswerKeyFromPageWithSplit(page, `Trang ${i + 1} (đáp án)`, warnings, 0, opts.model, opts.deadline, pageInfo?.[i]?.hint)
    )
  );

  const all: AnswerKeyEntry[] = [];
  perPageResults.forEach((entries, i) => {
    // Gợi ý trong prompt là cơ chế chính (ép AI dùng đúng số toàn cục); remap theo nhãn là lưới
    // an toàn thứ hai cho trường hợp AI phớt lờ gợi ý và vẫn trả số cục bộ như cũ.
    all.push(...remapToGlobalNumbers(entries, pageInfo?.[i]?.localToGlobal));
  });
  return all;
}

/**
 * Ghép đáp án đọc được từ file đáp án riêng vào danh sách câu hỏi đã trích xuất từ file đề
 * — match theo question_number (1-based trong file đáp án) với order_index (0-based) của
 * câu hỏi. Câu nào không có đáp án khớp thì giữ nguyên null/false mặc định (giáo viên tự
 * điền tay ở bước duyệt). KHÔNG gọi thêm Gemini — chỉ là object merge thuần JS.
 */
type KeyKind = "multiple_choice" | "true_false_group" | "short_answer";

const TYPE_DEFAULTS: Record<KeyKind, { score_rule: ExtractedExam["questions"][number]["score_rule"]; max_score: number }> = {
  multiple_choice: { score_rule: "standard", max_score: 0.25 },
  true_false_group: { score_rule: "thpt2025_truefalse_partial", max_score: 1.0 },
  short_answer: { score_rule: "standard", max_score: 0.5 },
};

/** Loại câu theo DỮ LIỆU thực tế của mục đáp án (có mệnh đề Đúng/Sai → đúng/sai; có chữ cái
 * → trắc nghiệm; có giá trị → điền ngắn) thay vì tin nhãn "type" model tự gán cho mục đó. */
function keyKind(e: AnswerKeyEntry): KeyKind | null {
  if (e.sub_statements?.length) return "true_false_group";
  if (e.correct_answer) return "multiple_choice";
  if (e.value) return "short_answer";
  return null;
}

/**
 * File đáp án là nguồn đáng tin hơn về LOẠI câu (bảng đáp án rất rõ: chữ cái / Đ-S / số), trong
 * khi loại câu AI tự suy từ ảnh đề đã sai thật (câu điền đáp án bị gán trắc nghiệm...). Chỉ
 * đổi loại khi hình dạng câu hỏi KHÔNG mâu thuẫn với loại trong file đáp án (vd file đáp án nói
 * "điền ngắn" thì câu phải không có lựa chọn/mệnh đề nào). Nếu mâu thuẫn (câu có 4 lựa chọn mà
 * đáp án lại là số) thì nhiều khả năng đánh số bị lệch — KHÔNG ghép, để cảnh báo cho giáo viên.
 */
function reconcileTypeWithKey(
  q: ExtractedExam["questions"][number],
  kind: KeyKind
): { q: ExtractedExam["questions"][number]; ok: boolean } {
  if (q.type === kind) return { q, ok: true };
  const opts = q.options?.length ?? 0;
  const subs = q.sub_statements?.length ?? 0;
  const compatible =
    kind === "short_answer" ? opts === 0 && subs === 0 : kind === "multiple_choice" ? opts > 0 && subs === 0 : subs > 0 && opts === 0;
  if (!compatible) return { q, ok: false };
  return { q: { ...q, type: kind, ...TYPE_DEFAULTS[kind] }, ok: true };
}

type QuestionItem = ExtractedExam["questions"][number];

/** Gắn thêm 1 cờ cảnh báo riêng cho câu (lưu trong extraction_meta). */
function withFlag(q: QuestionItem, flag: string): QuestionItem {
  const meta = q.extraction_meta ?? { flags: [] };
  return { ...q, extraction_meta: { ...meta, flags: [...meta.flags, flag] } };
}

export function mergeAnswerKeyIntoQuestions(
  questions: ExtractedExam["questions"],
  answerKey: AnswerKeyEntry[],
  warnings?: string[]
): ExtractedExam["questions"] {
  const byNumber = new Map(answerKey.map((a) => [a.question_number, a]));
  const typeFixed: number[] = [];
  const mismatched: number[] = [];
  const missing: number[] = [];
  const partialStatements: string[] = [];

  const merged = questions.map((q0, idx) => {
    const n = idx + 1;
    const entry = byNumber.get(n);
    const kind = entry ? keyKind(entry) : null;
    if (!entry || !kind) {
      missing.push(n);
      return withFlag(q0, "Chưa có đáp án từ file đáp án — giáo viên tự chọn đáp án đúng");
    }
    const { q, ok } = reconcileTypeWithKey(q0, kind);
    if (!ok) {
      mismatched.push(n);
      return withFlag(q0, "Loại câu không khớp loại đáp án trong file đáp án — CHƯA ghép đáp án, kiểm tra tay");
    }
    let out: QuestionItem = q;
    if (q !== q0) {
      typeFixed.push(n);
      out = withFlag(out, `Đã tự sửa loại câu theo file đáp án (từ ${q0.type} thành ${kind})`);
    }

    if (kind === "multiple_choice") {
      return { ...out, correct_answer: String(entry.correct_answer).trim().toUpperCase() };
    }
    if (kind === "true_false_group") {
      const answerByKey = new Map((entry.sub_statements ?? []).map((s) => [s.key, s.answer]));
      if (answerByKey.size > out.sub_statements.length) {
        partialStatements.push(`${n} (đọc được ${out.sub_statements.length}/${answerByKey.size} mệnh đề)`);
        out = withFlag(out, `Đề chỉ đọc được ${out.sub_statements.length}/${answerByKey.size} ý so với file đáp án`);
      }
      return {
        ...out,
        sub_statements: out.sub_statements.map((s) => ({
          ...s,
          answer: answerByKey.has(s.key) ? answerByKey.get(s.key)! : s.answer,
        })),
      };
    }
    return { ...out, short_answer_normalized: String(entry.value).trim() };
  });

  if (warnings) {
    if (typeFixed.length) {
      warnings.push(`Đã tự sửa loại câu hỏi theo file đáp án cho câu: ${typeFixed.join(", ")}.`);
    }
    if (mismatched.length) {
      warnings.push(
        `Câu ${mismatched.join(", ")}: loại câu hỏi không khớp loại đáp án trong file đáp án (nhiều khả năng đánh số lệch hoặc AI đọc sai cấu trúc câu) — hệ thống KHÔNG ghép đáp án cho các câu này, cần kiểm tra tay.`
      );
    }
    if (partialStatements.length) {
      warnings.push(`Câu đúng/sai thiếu mệnh đề so với file đáp án: ${partialStatements.join("; ")} — kiểm tra lại nội dung đề.`);
    }
    if (missing.length) {
      warnings.push(`Chưa có đáp án cho câu: ${missing.join(", ")} — giáo viên tự điền ở bước duyệt.`);
    }
    const keyCount = new Set(answerKey.map((a) => a.question_number)).size;
    if (keyCount > 0 && keyCount !== questions.length) {
      warnings.push(`Đề đọc được ${questions.length} câu nhưng file đáp án có ${keyCount} câu — kiểm tra xem có câu nào bị sót/gộp không.`);
    }
  }
  return merged;
}

interface PdfPageResult {
  title: string | null;
  subject: string | null;
  questions: Array<Record<string, unknown> & { figure_refs?: string[] }>;
  figures: Array<{ id: string; bbox_1000: [number, number, number, number] }>;
}

/**
 * Chế độ "chống trùng khớp": bắt model chèn ký hiệu phân tách (¦, U+00A6) giữa các cụm từ rồi
 * hệ thống tự xóa sau khi nhận về. ĐÃ KIỂM CHỨNG THỰC TẾ bằng gọi thẳng Gemini API trên đúng
 * 2 trang đề minh họa công khai hay bị RECITATION: prompt thường bị chặn 4/4 lần (mọi model
 * Gemini/Gemma đều vậy), còn prompt có quy tắc chèn ký hiệu thì Gemini trả STOP (đọc bình
 * thường) 100% các lần. Cơ chế của bộ lọc là so khớp chuỗi chữ LIỀN MẠCH của output với dữ
 * liệu đã biết — chèn ký hiệu làm đứt chuỗi liền mạch, trong khi nội dung sau khi xóa ký hiệu
 * vẫn y nguyên bản gốc. Chỉ dùng khi lần đọc thường đã bị RECITATION (không dùng mặc định vì
 * làm output dài hơn và có rủi ro nhỏ model chèn sai chỗ).
 */
export const MARKER_CHAR = "¦";
const MARKER_RULE = `
QUY TẮC BẮT BUỘC về định dạng văn bản: trong MỌI trường chữ (content_latex, text_latex), cứ sau mỗi khoảng 3 từ liên tiếp phải chèn thêm đúng 1 ký hiệu " ${MARKER_CHAR} " (dấu gạch đứt U+00A6, có khoảng trắng 2 bên) tại chỗ ĐÃ có khoảng trắng — cả trong câu dẫn lẫn trong phần lựa chọn/mệnh đề. KHÔNG chèn vào giữa 1 lệnh LaTeX, giữa các chữ số của 1 số, hay bên trong cặp ngoặc {}. Hệ thống sẽ tự xóa ký hiệu này sau nên bắt buộc làm đúng, không bỏ sót. Phần còn lại của schema JSON (type, key, figure_refs, figures...) giữ NGUYÊN như yêu cầu ở trên, vẫn trả về 1 object có khóa "questions" và "figures".`;

export function stripMarkers<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(new RegExp(`[ \\t]*${MARKER_CHAR}[ \\t]*`, "g"), " ") as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => stripMarkers(v)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripMarkers(v)])) as unknown as T;
  }
  return value;
}

/** Model đôi khi trả thẳng 1 mảng câu hỏi thay vì object {questions, figures} (hay gặp khi bị
 * ép định dạng) — chuẩn hóa về đúng PdfPageResult để phần xử lý phía sau không phải đoán. */
function normalizePageResult(raw: unknown): PdfPageResult {
  if (Array.isArray(raw)) {
    return { title: null, subject: null, questions: raw as PdfPageResult["questions"], figures: [] };
  }
  const obj = (raw ?? {}) as Partial<PdfPageResult>;
  return {
    title: obj.title ?? null,
    subject: obj.subject ?? null,
    questions: Array.isArray(obj.questions) ? obj.questions : [],
    figures: Array.isArray(obj.figures) ? obj.figures : [],
  };
}

async function ocrPdfPage(
  pagePngBase64: string,
  prevTail: string | null,
  warnings?: string[],
  temperature = 0,
  markerMode = false
): Promise<PdfPageResult> {
  if (provider() === "deepseek") {
    throw new Error("DeepSeek chưa hỗ trợ nhận ảnh trong pipeline này — dùng Gemini cho nhánh PDF.");
  }
  const continuationRule = prevTail
    ? CONTINUATION_RULE_TEMPLATE.replace("{prevTail}", prevTail)
    : "";
  const prompt = PDF_PAGE_PROMPT.replace("{continuationRule}", continuationRule) + (markerMode ? MARKER_RULE : "");
  const text = await callGeminiWithImage(pagePngBase64, prompt, "image/png", warnings, temperature);
  const parsed = normalizePageResult(extractJson(text));
  return markerMode ? stripMarkers(parsed) : parsed;
}

/**
 * Gemini đôi khi từ chối sinh nội dung (finishReason "RECITATION") khi nghi ngờ trang ảnh
 * trùng khớp với tài liệu có bản quyền đã biết (thực tế quan sát được: xảy ra cả ở TRANG
 * ĐẦU TIÊN, không riêng trang có ngữ cảnh nối tiếp từ trang trước như giả định ban đầu) —
 * với đề thi/tài liệu công khai (đề minh họa Bộ GD&ĐT...) đây gần như chắc chắn là false
 * positive vì nội dung hoàn toàn hợp pháp để trích xuất.
 *
 * ĐÃ KIỂM CHỨNG BẰNG SCRIPT GỌI THẲNG GEMINI API thực tế (không phải suy đoán):
 * - Đổi temperature KHÔNG giúp ích gì (vẫn bị chặn ở temperature=1.0).
 * - Đổi sang model Gemini/Gemma khác KHÔNG giúp ích (mọi model trả lời được đều bị chặn).
 * - Chế độ chống trùng khớp (chèn ký hiệu rồi xóa, xem MARKER_RULE) tránh được lỗi này ở
 *   mọi lần thử — đây là bước thử ĐẦU TIÊN khi bị chặn vì giữ nguyên cả trang (không mất
 *   ngữ cảnh/hình, chỉ tốn thêm 1 lệnh gọi).
 * - Cắt đôi trang (processPageImage) là phương án tiếp theo nếu chế độ trên vẫn thất bại.
 */
async function ocrPdfPageWithRecitationRetry(
  pagePngBase64: string,
  prevTail: string | null,
  warnings?: string[]
): Promise<PdfPageResult> {
  try {
    return await ocrPdfPage(pagePngBase64, prevTail, warnings, 0, false);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes("RECITATION")) throw e;
    try {
      const result = await ocrPdfPage(pagePngBase64, prevTail, warnings, 0, true);
      const note = "Một số trang bị Gemini chặn vì nghi trùng bản quyền (đề công khai) — hệ thống đã đọc lại bằng chế độ chống trùng khớp; nội dung vẫn đủ nhưng nên rà soát kỹ các trang này.";
      if (warnings && !warnings.includes(note)) warnings.push(note);
      return result;
    } catch {
      // Chế độ chống trùng khớp cũng thất bại (RECITATION/lỗi parse/lỗi mạng) — trả về lỗi
      // RECITATION gốc để lớp gọi chuyển sang phương án kế tiếp (tách đôi trang, model dự phòng).
      throw e;
    }
  }
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
  pdfBuffer: Buffer,
  warnings?: string[]
): Promise<{ extracted: ExtractedExam; images: Map<string, Buffer> }> {
  const { renderPdfPages } = await import("./pdfRender");
  return extractImagePages(renderPdfPages(pdfBuffer, 200), warnings);
}

/** Đề thi dạng 1 ảnh chụp duy nhất (jpg/png) — xử lý như PDF 1 trang, dùng chung pipeline
 * OCR + crop hình với extractPdfPages. */
export async function extractExamFromImage(
  imageBuffer: Buffer,
  warnings?: string[]
): Promise<{ extracted: ExtractedExam; images: Map<string, Buffer> }> {
  return extractImagePages([imageBuffer], warnings);
}

async function extractImagePages(
  pagePngs: Buffer[],
  warnings?: string[]
): Promise<{ extracted: ExtractedExam; images: Map<string, Buffer> }> {
  const sharp = (await import("sharp")).default;

  const images = new Map<string, Buffer>();
  const allQuestions: ExtractedExam["questions"] = [];
  let title: string | null = null;
  let subject: string | null = null;

  /**
   * Xử lý 1 ảnh trang (hoặc 1 nửa trang khi fallback split) qua Gemini vision, cắt hình vẽ,
   * ghép câu hỏi vào allQuestions, trả về prevTail mới để truyền tiếp. Khi gặp RECITATION
   * (Gemini từ chối vì nghi trùng bản quyền) ngay cả sau khi đã thử nhiều temperature —
   * kiểm chứng thực tế (script chẩn đoán, không phải suy đoán): cắt đôi trang theo chiều dọc
   * (có chồng lấn 10% ở giữa để không mất câu nằm sát ranh giới) và đọc từng nửa riêng biệt
   * LUÔN tránh được lỗi này, vì bộ lọc recitation nhạy với khối text liền mạch dài bằng cả
   * trang — khối nhỏ hơn không đủ dài để khớp. Tái dùng nguyên cơ chế "câu bị cắt ngang
   * trang" (prevTail/CONTINUATION_MARKER) sẵn có để ghép 2 nửa lại liền mạch, chỉ thử split
   * tối đa 1 lần (depth) để tránh đệ quy vô hạn nếu 1 nửa vẫn tiếp tục bị chặn.
   */
  async function processPageImage(
    pagePng: Buffer,
    prevTailIn: string | null,
    pageLabel: string,
    fileLabel: string,
    captureTitleSubject: boolean,
    depth: number
  ): Promise<string | null> {
    const { width, height } = await sharp(pagePng).metadata();

    let result: PdfPageResult;
    try {
      result = await ocrPdfPageWithRecitationRetry(pagePng.toString("base64"), prevTailIn, warnings);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("RECITATION") || !height) throw e;

      if (depth >= 1) {
        // Đã thử split 1 lần rồi mà nửa này vẫn kẹt — thử model dự phòng (Qwen, không có bộ
        // lọc recitation) trước khi chịu thua hẳn, không split tiếp để tránh đệ quy vô hạn.
        const continuationRule = prevTailIn ? CONTINUATION_RULE_TEMPLATE.replace("{prevTail}", prevTailIn) : "";
        const fallbackPrompt = PDF_PAGE_PROMPT.replace("{continuationRule}", continuationRule);
        const fallbackText = await callVisionFallback(pagePng.toString("base64"), fallbackPrompt, warnings);
        if (!fallbackText) {
          warnings?.push(`${pageLabel}: ${message} — các câu hỏi ở phần này sẽ bị thiếu, cần giáo viên tự nhập tay.`);
          return null;
        }
        try {
          result = normalizePageResult(extractJson(fallbackText));
        } catch {
          warnings?.push(`${pageLabel}: model dự phòng trả về dữ liệu không đọc được — các câu hỏi ở phần này sẽ bị thiếu, cần giáo viên tự nhập tay.`);
          return null;
        }
        // result lấy được từ model dự phòng — rơi xuống phần xử lý figure/câu hỏi chung bên
        // dưới (sau khối try/catch), giống hệt nhánh Gemini thành công bình thường.
      } else {
        warnings?.push(`${pageLabel}: Gemini từ chối đọc do nghi ngờ bản quyền — hệ thống tự tách đôi trang để đọc riêng từng nửa (đã kiểm chứng cách này tránh được lỗi).`);
        const topHeight = Math.round(height * 0.55);
        const bottomTop = Math.round(height * 0.45);
        const topHalf = await sharp(pagePng).extract({ left: 0, top: 0, width, height: topHeight }).png().toBuffer();
        const bottomHalf = await sharp(pagePng).extract({ left: 0, top: bottomTop, width, height: height - bottomTop }).png().toBuffer();

        let tail = await processPageImage(topHalf, prevTailIn, `${pageLabel} (nửa trên)`, `${fileLabel}a`, captureTitleSubject, depth + 1);
        tail = await processPageImage(bottomHalf, tail, `${pageLabel} (nửa dưới)`, `${fileLabel}b`, captureTitleSubject, depth + 1);
        return tail;
      }
    }

    if (captureTitleSubject) {
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

      const filename = `page${fileLabel}_${fig.id}.png`;
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
      // Đề THPT hiếm khi 1 câu có >2 hình minh họa — nếu Gemini gán nhiều hình không liên
      // quan vào cùng 1 câu (quan sát thực tế: dồn hết hình của trang vào câu cuối cùng),
      // cảnh báo để giáo viên kiểm tra lại thay vì âm thầm hiển thị sai cho học sinh.
      if (imageUrls.length > 2 && warnings) {
        warnings.push(
          `${pageLabel}: có 1 câu hỏi được gán ${imageUrls.length} hình minh họa cùng lúc — kiểm tra lại xem có hình nào bị gán nhầm từ câu khác không.`
        );
      }
      const contentStr = String(q.content_latex ?? "");

      if (qi === 0 && contentStr.startsWith(CONTINUATION_MARKER) && allQuestions.length > 0) {
        // Câu đầu trang/nửa trang này là phần tiếp của câu cuối trước đó — ghép lại thành 1
        // câu, không push thêm entry mới. Ưu tiên type/sub_statements/options của lần đọc
        // này (sau khi đã thấy đủ nội dung) vì lượt trước có thể đã đoán sai type do thiếu
        // thông tin (vd đoán multiple_choice vì chưa thấy mệnh đề a/b/c/d).
        const prev = allQuestions[allQuestions.length - 1] as unknown as Record<string, unknown>;
        const mergedContent = `${String(prev.content_latex ?? "")} ${contentStr.slice(CONTINUATION_MARKER.length).trim()}`.trim();
        // Hợp nhất options/sub_statements theo key (nửa sau thắng nếu trùng key) thay vì ghi
        // đè nguyên mảng — kiểm chứng thực tế: câu Đúng/Sai bị cắt ngang trang chỉ còn 3/4
        // mệnh đề vì mệnh đề a) ở nửa trước bị mảng của nửa sau đè mất.
        allQuestions[allQuestions.length - 1] = {
          ...prev,
          ...q,
          content_latex: mergedContent,
          image_urls: [...((prev.image_urls as string[]) ?? []), ...imageUrls],
          options: unionByKey(prev.options, (q as Record<string, unknown>).options),
          sub_statements: unionByKey(prev.sub_statements, (q as Record<string, unknown>).sub_statements),
        } as ExtractedExam["questions"][number];
      } else {
        allQuestions.push({ ...q, image_urls: imageUrls } as ExtractedExam["questions"][number]);
      }
    }

    return pageQuestions.length > 0 ? summarizeQuestionTail(pageQuestions[pageQuestions.length - 1]) : prevTailIn;
  }

  let prevTail: string | null = null;
  for (let pageIndex = 0; pageIndex < pagePngs.length; pageIndex++) {
    prevTail = await processPageImage(
      pagePngs[pageIndex],
      prevTail,
      `Trang ${pageIndex + 1}`,
      String(pageIndex + 1),
      pageIndex === 0,
      0
    );
  }

  return {
    extracted: {
      title: title ?? "",
      subject: subject ?? "",
      source_branch: "PDF_IMAGE_ONLY",
      questions: allQuestions.map(fixQuestionTypeFromShape),
    },
    images,
  };
}

/** Gộp 2 mảng {key,...} theo key, phần tử sau thắng nếu trùng key, giữ thứ tự xuất hiện. */
function unionByKey(a: unknown, b: unknown): Array<{ key: string }> {
  const out = new Map<string, { key: string }>();
  for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (item && typeof (item as { key?: unknown }).key === "string") {
      out.set((item as { key: string }).key, item as { key: string });
    }
  }
  return [...out.values()];
}

/**
 * Sửa kiểu câu hỏi theo "hình dạng" dữ liệu thực tế khi model gán sai (quan sát thực tế khi
 * đọc ở chế độ chống trùng khớp/tách đôi trang: câu điền đáp án ngắn bị gán multiple_choice
 * với 0 lựa chọn → học sinh không có ô nhập, đáp án từ file đáp án cũng không ghép được):
 * - multiple_choice nhưng không có lựa chọn nào: có mệnh đề → true_false_group, không → short_answer
 * - true_false_group nhưng không có mệnh đề mà có lựa chọn → multiple_choice
 */
function fixQuestionTypeFromShape(q: ExtractedExam["questions"][number]): ExtractedExam["questions"][number] {
  const optionCount = Array.isArray(q.options) ? q.options.length : 0;
  const subCount = Array.isArray(q.sub_statements) ? q.sub_statements.length : 0;
  if (q.type === "multiple_choice" && optionCount === 0) {
    if (subCount > 0) {
      return { ...q, type: "true_false_group", score_rule: "thpt2025_truefalse_partial", max_score: 1.0 };
    }
    return { ...q, type: "short_answer", score_rule: "standard", max_score: 0.5 };
  }
  if (q.type === "true_false_group" && subCount === 0 && optionCount > 0) {
    return { ...q, type: "multiple_choice", score_rule: "standard", max_score: 0.25 };
  }
  return q;
}
