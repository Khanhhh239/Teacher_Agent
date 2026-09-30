import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Question } from "@/types/exam";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const supabase = createAdminClient();

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("*, exam_rooms(*, exams(*))")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Không tìm thấy phiên thi" }, { status: 404 });
  }

  const exam = session.exam_rooms.exams;
  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("exam_id", exam.id);

  const byId = new Map((questions as Question[]).map((q) => [q.id, q]));
  const orderedQuestions = (session.question_order as string[])
    .map((id) => byId.get(id))
    .filter((q): q is Question => !!q)
    .map((q) => {
      const orderedKeys = session.option_order?.[q.id] as string[] | undefined;
      const options = orderedKeys
        ? orderedKeys.map((key) => q.options.find((o) => o.key === key)!).filter(Boolean)
        : q.options;
      return {
        id: q.id,
        type: q.type,
        content_latex: q.content_latex,
        image_url: q.image_url,
        options,
        sub_statements: q.sub_statements.map((s) => ({ key: s.key, text_latex: s.text_latex })),
        max_score: q.max_score,
        // KHÔNG trả correct_answer / short_answer_normalized cho học sinh
      };
    });

  const startedAt = new Date(session.started_at).getTime();
  const durationMs = exam.duration_minutes * 60 * 1000;
  const remainingSeconds = Math.max(0, Math.round((startedAt + durationMs - Date.now()) / 1000));

  const { data: existingAnswers } = await supabase
    .from("student_answers")
    .select("question_id, answer")
    .eq("session_id", sessionId);

  return NextResponse.json({
    session_id: session.id,
    status: session.status,
    exam_title: exam.title,
    require_fullscreen: session.exam_rooms.require_fullscreen,
    remaining_seconds: remainingSeconds,
    questions: orderedQuestions,
    existing_answers: existingAnswers ?? [],
  });
}
