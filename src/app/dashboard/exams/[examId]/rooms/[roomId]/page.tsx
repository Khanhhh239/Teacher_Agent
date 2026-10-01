import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { RoomCharts } from "@/components/RoomCharts";
import type { ExamRoom, ExamSession, Question } from "@/types/exam";

export default async function RoomResultsPage({
  params,
}: {
  params: Promise<{ examId: string; roomId: string }>;
}) {
  const { examId, roomId } = await params;
  const supabase = await createClient();

  const { data: room } = await supabase.from("exam_rooms").select("*").eq("id", roomId).single();
  if (!room) notFound();

  const { data: sessions } = await supabase
    .from("exam_sessions")
    .select("*")
    .eq("room_id", roomId)
    .order("started_at", { ascending: false });

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("exam_id", examId)
    .order("order_index");

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: allAnswers } =
    sessionIds.length > 0
      ? await supabase.from("student_answers").select("*").in("session_id", sessionIds)
      : { data: [] };

  // Tính tỉ lệ đúng từng câu: đếm số bài làm có is_correct true (trắc nghiệm/tự luận) hoặc
  // đạt trọn điểm (đúng/sai từng phần) trên tổng số bài đã có câu trả lời cho câu đó.
  const questionStats = (questions as Question[] | null)?.map((q, idx) => {
    const answersForQ = (allAnswers ?? []).filter((a) => a.question_id === q.id);
    const correct = answersForQ.filter((a) =>
      q.type === "true_false_group" ? (a.score ?? 0) >= q.max_score : a.is_correct
    ).length;
    return { label: `Câu ${idx + 1}`, correct, total: answersForQ.length };
  }) ?? [];

  const gradedScores = (sessions ?? [])
    .filter((s) => s.total_score !== null)
    .map((s) => s.total_score as number);
  const maxPossible = (questions ?? []).reduce((sum, q) => sum + q.max_score, 0) || 10;
  const bucketCount = 5;
  const bucketSize = maxPossible / bucketCount;
  const scoreDistribution = Array.from({ length: bucketCount }, (_, i) => {
    const lo = i * bucketSize;
    const hi = i === bucketCount - 1 ? maxPossible + 0.001 : (i + 1) * bucketSize;
    const count = gradedScores.filter((s) => s >= lo && s < hi).length;
    return { label: `${lo.toFixed(1)}-${(hi > maxPossible ? maxPossible : hi).toFixed(1)}`, value: count };
  });

  const csvRows: (string | number)[][] = [
    ["Họ tên", "SBD", "Trạng thái", "Điểm", "Vi phạm", "Nộp lúc"],
    ...((sessions as ExamSession[] | null) ?? []).map((s) => [
      s.student_name,
      s.student_code,
      s.status === "in_progress" ? "Đang làm" : "Đã nộp",
      s.total_score ?? "",
      s.violation_count,
      s.submitted_at ? new Date(s.submitted_at).toLocaleString("vi-VN") : "",
    ]),
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            Kết quả phòng thi <span className="font-mono">{(room as ExamRoom).code}</span>
          </h1>
          <p className="text-sm text-slate-500">{sessions?.length ?? 0} học sinh đã tham gia</p>
        </div>
        <ExportCsvButton filename={`ket-qua-${(room as ExamRoom).code}.csv`} rows={csvRows} />
      </div>

      {gradedScores.length > 0 && (
        <div className="mb-4">
          <RoomCharts scoreDistribution={scoreDistribution} questionStats={questionStats} />
        </div>
      )}

      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            <th className="px-3 py-2">Học sinh</th>
            <th className="px-3 py-2">SBD</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Điểm</th>
            <th className="px-3 py-2">Vi phạm</th>
            <th className="px-3 py-2">Nộp lúc</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {(sessions as ExamSession[] | null)?.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="px-3 py-2">{s.student_name}</td>
              <td className="px-3 py-2">{s.student_code}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === "submitted" || s.status === "graded"
                      ? "bg-green-100 text-green-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {s.status === "in_progress" ? "Đang làm" : "Đã nộp"}
                  {s.kicked_at ? " (bị đuổi)" : ""}
                </span>
              </td>
              <td className="px-3 py-2 font-semibold">{s.total_score ?? "—"}</td>
              <td className="px-3 py-2">
                {s.violation_count > 0 ? (
                  <span className="font-medium text-red-600">{s.violation_count}</span>
                ) : (
                  0
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">
                {s.submitted_at ? new Date(s.submitted_at).toLocaleString("vi-VN") : "—"}
              </td>
              <td className="px-3 py-2">
                <Link href={`/dashboard/exams/${examId}/rooms/${roomId}/students/${s.id}`} className="text-sm font-medium underline">
                  Xem chi tiết →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sessions?.length && (
        <p className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
          Chưa có học sinh nào tham gia phòng thi này.
        </p>
      )}
    </div>
  );
}
