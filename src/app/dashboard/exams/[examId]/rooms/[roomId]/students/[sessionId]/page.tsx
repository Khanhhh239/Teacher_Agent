import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LatexText } from "@/components/Latex";
import { buildSessionBreakdown } from "@/lib/sessionBreakdown";

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

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <h1 className="text-lg font-semibold">
          {session.student_name} {session.student_code && <span className="text-slate-500">· SBD {session.student_code}</span>}
        </h1>
        <p className="text-sm text-slate-500">
          Điểm: <span className="font-semibold">{session.total_score ?? "—"}</span> · {violations?.length ?? 0} vi phạm
        </p>
      </div>

      {violations && violations.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
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

      <div className="space-y-3">
        {breakdown.map((q, idx) => (
          <div key={q.id} className="rounded-lg border bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p>
                <span className="font-bold">Câu {idx + 1}.</span> <LatexText text={q.content_latex} />
              </p>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">
                {q.score}/{q.max_score}đ
              </span>
            </div>

            {q.type === "multiple_choice" && (
              <ul className="ml-1 space-y-1 text-sm">
                {q.options.map((o) => {
                  const selected = (q.student_answer as { selected: string } | null)?.selected === o.key;
                  return (
                    <li
                      key={o.key}
                      className={o.key === q.correct_answer ? "font-semibold text-green-700" : selected ? "text-red-700" : ""}
                    >
                      {o.key}. <LatexText text={o.text_latex} /> {selected && "← học sinh chọn"}
                    </li>
                  );
                })}
              </ul>
            )}

            {q.type === "true_false_group" && (
              <ul className="ml-1 space-y-1 text-sm">
                {q.sub_statements.map((s) => {
                  const studentVal = (q.student_answer as { statements: Record<string, boolean> } | null)?.statements?.[
                    s.key
                  ];
                  return (
                    <li key={s.key} className={studentVal === s.answer ? "text-green-700" : "text-red-700"}>
                      {s.key}) <LatexText text={s.text_latex} /> — học sinh: {studentVal === undefined ? "—" : studentVal ? "Đúng" : "Sai"}, đáp án: {s.answer ? "Đúng" : "Sai"}
                    </li>
                  );
                })}
              </ul>
            )}

            {q.type === "short_answer" && (
              <p className="text-sm">
                Học sinh trả lời: <span className="font-medium">{(q.student_answer as { text: string } | null)?.text || "(bỏ trống)"}</span> ·
                Đáp án đúng: <span className="font-medium text-green-700">{q.short_answer_normalized}</span>
              </p>
            )}
          </div>
        ))}
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
