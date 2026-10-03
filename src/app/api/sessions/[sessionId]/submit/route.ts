import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreExam } from "@/lib/scoring";
import type { Question, StudentAnswerPayload } from "@/types/exam";

// Học sinh KHÔNG được xem điểm/đáp án đúng ngay sau khi nộp — chỉ giáo viên xem được ở trang
// quản lý phòng thi. Route này vì vậy chỉ trả về trạng thái nộp bài, không trả total_score hay
// breakdown câu hỏi, để không lộ qua network response dù UI không hiển thị.
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
    return NextResponse.json({ ok: true, already_submitted: true });
  }

  const [{ data: questions }, { data: answers }] = await Promise.all([
    supabase.from("questions").select("*").eq("exam_id", examId),
    supabase.from("student_answers").select("*").eq("session_id", sessionId),
  ]);

  const answerMap = new Map<string, StudentAnswerPayload>(
    (answers ?? []).map((a) => [a.question_id, a.answer])
  );

  const { totalScore, perQuestion } = scoreExam(questions as Question[], answerMap);

  // Ghi điểm từng câu song song (thay vì tuần tự) — với đề 20-30 câu, chờ tuần tự từng round-trip
  // DB khiến "đang tính điểm" mất vài giây dù phép tính điểm bản thân nó tức thời.
  await Promise.all([
    ...Array.from(perQuestion)
      .filter(([questionId]) => answerMap.has(questionId))
      .map(([questionId, result]) =>
        supabase
          .from("student_answers")
          .update({ is_correct: result.is_correct, score: result.score })
          .eq("session_id", sessionId)
          .eq("question_id", questionId)
      ),
    supabase
      .from("exam_sessions")
      .update({
        status: "graded",
        submitted_at: new Date().toISOString(),
        total_score: totalScore,
      })
      .eq("id", sessionId),
  ]);

  return NextResponse.json({ ok: true });
}
