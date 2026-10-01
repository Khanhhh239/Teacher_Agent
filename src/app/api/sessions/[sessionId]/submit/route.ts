import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreExam } from "@/lib/scoring";
import { buildSessionBreakdown } from "@/lib/sessionBreakdown";
import type { Question, StudentAnswerPayload } from "@/types/exam";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const supabase = createAdminClient();

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("*, exam_rooms(exam_id)")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Không tìm thấy phiên thi" }, { status: 404 });
  }
  const examId = session.exam_rooms.exam_id;

  if (session.status !== "in_progress") {
    const breakdown = await buildSessionBreakdown(supabase, session, examId);
    return NextResponse.json({ total_score: session.total_score, already_submitted: true, questions: breakdown });
  }

  const { data: questions } = await supabase.from("questions").select("*").eq("exam_id", examId);

  const { data: answers } = await supabase
    .from("student_answers")
    .select("*")
    .eq("session_id", sessionId);

  const answerMap = new Map<string, StudentAnswerPayload>(
    (answers ?? []).map((a) => [a.question_id, a.answer])
  );

  const { totalScore, perQuestion } = scoreExam(questions as Question[], answerMap);

  for (const [questionId, result] of perQuestion) {
    if (!answerMap.has(questionId)) continue;
    await supabase
      .from("student_answers")
      .update({ is_correct: result.is_correct, score: result.score })
      .eq("session_id", sessionId)
      .eq("question_id", questionId);
  }

  await supabase
    .from("exam_sessions")
    .update({
      status: "graded",
      submitted_at: new Date().toISOString(),
      total_score: totalScore,
    })
    .eq("id", sessionId);

  const breakdown = await buildSessionBreakdown(supabase, session, examId);
  return NextResponse.json({ total_score: totalScore, questions: breakdown });
}
