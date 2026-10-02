import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildSessionBreakdown } from "@/lib/sessionBreakdown";
import { QuestionAnswerSplit, type Correctness, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import type { StudentAnswerPayload } from "@/types/exam";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ examId: string; roomId: string; sessionId: string }>;
}) {
  const { examId, sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase.from("exam_sessions").select("*").eq("id", sessionId).single();
  if (!session) notFound();

  const breakdown = await buildSessionBreakdown(supabase, session, examId);
  const { data: violations } = await supabase
    .from("exam_violations")
    .select("*")
    .eq("session_id", sessionId)
    .order("occurred_at");

  const splitQuestions: SplitQuestion[] = breakdown.map((q, idx) => ({
    id: q.id,
    number: idx + 1,
    part_label: q.part_label,
    source_crop_url: q.source_crop_url,
    type: q.type,
    optionKeys: q.options.map((o) => o.key),
    subKeys: q.sub_statements.map((s) => s.key),
  }));
  const values: Record<string, StudentAnswerPayload | null> = {};
  const correctness: Record<string, Correctness> = {};
  for (const q of breakdown) {
    values[q.id] = q.student_answer;
    correctness[q.id] = {
      correctAnswer: q.correct_answer,
      correctStatements: Object.fromEntries(q.sub_statements.map((s) => [s.key, s.answer])),
      correctText: q.short_answer_normalized,
    };
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col space-y-3">
      <div className="shrink-0 rounded-lg border bg-white p-4">
        <h1 className="text-lg font-semibold">
          {session.student_name} {session.student_code && <span className="text-slate-500">· SBD {session.student_code}</span>}
        </h1>
        <p className="text-sm text-slate-500">
          Điểm: <span className="font-semibold">{session.total_score ?? "—"}</span> · {violations?.length ?? 0} vi phạm
        </p>
      </div>

      {violations && violations.length > 0 && (
        <div className="shrink-0 rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Chi tiết vi phạm</h2>
          <ul className="space-y-1 text-sm">
            {violations.map((v) => (
              <li key={v.id} className="flex justify-between border-b py-1 last:border-0">
                <span>{VIOLATION_LABELS[v.type as string] ?? v.type}</span>
                <span className="text-slate-500">{new Date(v.occurred_at).toLocaleTimeString("vi-VN")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <QuestionAnswerSplit questions={splitQuestions} values={values} showCorrectness correctness={correctness} />
      </div>
    </div>
  );
}

const VIOLATION_LABELS: Record<string, string> = {
  tab_blur: "Chuyển tab / mất focus",
  fullscreen_exit: "Thoát toàn màn hình",
  devtools_key: "Bấm phím mở DevTools/In",
  copy_paste: "Copy/Paste",
  right_click: "Click chuột phải",
};
