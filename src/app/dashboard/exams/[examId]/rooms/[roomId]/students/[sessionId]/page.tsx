import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildSessionBreakdown } from "@/lib/sessionBreakdown";
import { QuestionAnswerSplit, type Correctness, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import { VIOLATION_LABELS } from "@/lib/violationLabels";
import type { StudentAnswerPayload, ViolationType } from "@/types/exam";

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
      <div className="card shrink-0 p-4">
        <h1 className="text-lg font-semibold text-slate-900">
          {session.student_name} {session.student_code && <span className="text-slate-500">· SBD {session.student_code}</span>}
        </h1>
        <p className="text-sm text-slate-500">
          Điểm: <span className="font-semibold text-indigo-700">{session.total_score ?? "—"}</span> · {violations?.length ?? 0} vi phạm
        </p>
      </div>

      {violations && violations.length > 0 && (
        <div className="card shrink-0 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Chi tiết vi phạm</h2>
          <ul className="space-y-1 text-sm">
            {violations.map((v) => (
              <li key={v.id} className="flex justify-between border-b border-slate-100 py-1.5 last:border-0">
                <span className="text-slate-700">{VIOLATION_LABELS[v.type as ViolationType] ?? v.type}</span>
                <span className="text-slate-400">{new Date(v.occurred_at).toLocaleTimeString("vi-VN")}</span>
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
