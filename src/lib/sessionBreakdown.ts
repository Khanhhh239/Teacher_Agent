import type { Question } from "@/types/exam";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Ghép câu hỏi + đáp án học sinh theo đúng thứ tự đã xáo trộn khi thi — dùng chung cho
 * trang kết quả học sinh và trang xem chi tiết của giáo viên. */
export async function buildSessionBreakdown(
  supabase: SupabaseClient,
  session: { id: string; question_order: string[]; option_order: Record<string, string[]> },
  examId: string
) {
  const { data: questions } = await supabase.from("questions").select("*").eq("exam_id", examId);
  const { data: answers } = await supabase.from("student_answers").select("*").eq("session_id", session.id);

  const byId = new Map((questions as Question[]).map((q) => [q.id, q]));
  const answerById = new Map((answers ?? []).map((a) => [a.question_id, a]));

  return (session.question_order ?? [])
    .map((qid) => byId.get(qid))
    .filter((q): q is Question => !!q)
    .map((q) => {
      const orderedKeys = session.option_order?.[q.id] as string[] | undefined;
      const options = orderedKeys
        ? orderedKeys.map((key) => q.options.find((o) => o.key === key)!).filter(Boolean)
        : q.options;
      const studentAnswer = answerById.get(q.id);
      return {
        id: q.id,
        type: q.type,
        part_label: q.part_label,
        source_crop_url: q.source_crop_url ?? null,
        options,
        sub_statements: q.sub_statements,
        max_score: q.max_score,
        correct_answer: q.correct_answer,
        short_answer_normalized: q.short_answer_normalized,
        student_answer: studentAnswer?.answer ?? null,
        is_correct: studentAnswer?.is_correct ?? null,
        score: studentAnswer?.score ?? 0,
      };
    });
}
