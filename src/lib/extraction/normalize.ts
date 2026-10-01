import type { ExtractedExam } from "@/types/exam";

/**
 * LLM được dặn xóa marker [IMAGE:...] khỏi content_latex sau khi gán vào image_urls,
 * nhưng không phải lúc nào cũng tuân thủ 100% — đặc biệt khi 1 câu có nhiều marker liên
 * tiếp (đã quan sát thực tế: ảnh được gán đúng vào image_urls nhưng marker vẫn còn sót
 * trong text). Không nên phụ thuộc hoàn toàn vào việc LLM làm đúng 1 việc code có thể tự
 * đảm bảo chắc chắn — dọn sạch mọi marker còn sót lại ở đây bất kể LLM có xóa hay chưa.
 */
/**
 * LLM hay viết $\vec{v_3}$ (dấu accent bọc luôn cả chỉ số dưới thành 1 khối) thay vì
 * $\vec{v}_3$ (chỉ số đặt NGOÀI accent) — về mặt LaTeX cả 2 cách viết đều "hợp lệ cú
 * pháp", nhưng KaTeX đặt mũi tên/mũ dựa trên bề rộng toàn bộ base+subscript khi chúng bị
 * gộp chung trong 1 accent, khiến mũi tên lệch vị trí và nhìn như ký tự khác (quan sát
 * thực tế: "v_3" với \vec bọc ngoài hiển thị trông giống chữ "y3"). Tách chỉ số ra ngoài
 * accent để KaTeX đặt đúng vị trí, không đổi ý nghĩa toán học.
 */
function fixAccentOverScript(text: string): string {
  return text.replace(
    /\\(vec|hat|widehat|overline|bar|tilde)\{([A-Za-z]+)([_^])(\{[^{}]*\}|[A-Za-z0-9])\}/g,
    (_m, cmd: string, base: string, scriptType: string, script: string) => {
      const scriptContent = script.startsWith("{") ? script : `{${script}}`;
      return `\\${cmd}{${base}}${scriptType}${scriptContent}`;
    }
  );
}

function stripImageMarkers(text: string): string {
  return fixAccentOverScript(text)
    .replace(/\[IMAGE:[^\]]*\]/g, "")
    // LLM đôi khi double-escape "\n" thành literal 2 ký tự backslash+n thay vì JSON tự
    // decode thành 1 ký tự xuống dòng thật — còn sót lại dạng text thô "\n" hiển thị cho
    // học sinh (đặc biệt quanh bảng Markdown, nơi \n cần là xuống dòng thật để tách dòng).
    // Chỉ loại trừ \neq, \nabla (lệnh LaTeX thật bắt đầu bằng "n") — KHÔNG dùng
    // (?![a-zA-Z]) chung chung vì câu tiếng Việt sau xuống dòng luôn viết hoa chữ đầu.
    .replace(/\\n(?!eq|abla)/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/**
 * LLM đôi khi trả JSON null tường minh (không chỉ thiếu key) cho các trường không áp
 * dụng — DB không cho NULL ở cột options/sub_statements nên phải ép giá trị ở đây.
 * Port từ pipeline/extract.py's _set_default().
 */
/** LLM đôi khi trả "image_urls": [...] (đúng schema mới), đôi khi vẫn trả "image_url": "..."
 * (schema cũ, hoặc tự rút gọn khi chỉ có 1 ảnh) — chấp nhận cả 2 dạng, luôn chuẩn hóa về mảng. */
function normalizeImageUrls(question: Record<string, unknown>): string[] {
  const arr = question.image_urls;
  if (Array.isArray(arr)) return arr.filter((u): u is string => typeof u === "string" && u.length > 0);
  const single = question.image_url;
  if (typeof single === "string" && single.length > 0) return [single];
  return [];
}

export function normalizeExtractedExam(raw: unknown): ExtractedExam {
  const data = raw as Partial<ExtractedExam> & { questions?: unknown[] };
  const questions = (data.questions ?? []).map((q) => {
    const question = q as Record<string, unknown>;
    return {
      type: question.type ?? "short_answer",
      content_latex: stripImageMarkers(String(question.content_latex ?? "")),
      image_urls: normalizeImageUrls(question),
      options: ((question.options as Array<Record<string, unknown>>) ?? []).map((o) => ({
        key: o.key ?? "",
        text_latex: stripImageMarkers(String(o.text_latex ?? "")),
      })),
      sub_statements: ((question.sub_statements as Array<Record<string, unknown>>) ?? []).map((s) => ({
        key: s.key ?? "",
        text_latex: stripImageMarkers(String(s.text_latex ?? "")),
        answer: s.answer ?? false,
      })),
      correct_answer: question.correct_answer ?? null,
      short_answer_normalized: question.short_answer_normalized ?? null,
      score_rule: question.score_rule ?? "standard",
      max_score: question.max_score ?? 0.25,
      raw_ocr_notes: question.raw_ocr_notes ?? null,
    };
  });

  return {
    title: data.title || "Đề thi chưa đặt tên",
    subject: data.subject || "",
    source_branch: data.source_branch ?? "MANUAL",
    questions: questions as ExtractedExam["questions"],
  };
}
