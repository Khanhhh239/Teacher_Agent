import type { ExtractedExam } from "@/types/exam";

/**
 * LLM đôi khi trả JSON null tường minh (không chỉ thiếu key) cho các trường không áp
 * dụng — DB không cho NULL ở cột options/sub_statements nên phải ép giá trị ở đây.
 * Port từ pipeline/extract.py's _set_default().
 */
export function normalizeExtractedExam(raw: unknown): ExtractedExam {
  const data = raw as Partial<ExtractedExam> & { questions?: unknown[] };
  const questions = (data.questions ?? []).map((q) => {
    const question = q as Record<string, unknown>;
    return {
      type: question.type ?? "short_answer",
      content_latex: question.content_latex ?? "",
      image_url: question.image_url ?? null,
      options: question.options ?? [],
      sub_statements: ((question.sub_statements as Array<Record<string, unknown>>) ?? []).map((s) => ({
        key: s.key ?? "",
        text_latex: s.text_latex ?? "",
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
