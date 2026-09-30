import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ExamRoom, ExamSession } from "@/types/exam";

export default async function RoomResultsPage({
  params,
}: {
  params: Promise<{ examId: string; roomId: string }>;
}) {
  const { roomId } = await params;
  const supabase = await createClient();

  const { data: room } = await supabase.from("exam_rooms").select("*").eq("id", roomId).single();
  if (!room) notFound();

  const { data: sessions } = await supabase
    .from("exam_sessions")
    .select("*")
    .eq("room_id", roomId)
    .order("started_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">
        Kết quả phòng thi <span className="font-mono">{(room as ExamRoom).code}</span>
      </h1>
      <p className="mb-4 text-sm text-slate-500">{sessions?.length ?? 0} học sinh đã tham gia</p>

      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            <th className="px-3 py-2">Học sinh</th>
            <th className="px-3 py-2">SBD</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Điểm</th>
            <th className="px-3 py-2">Vi phạm</th>
            <th className="px-3 py-2">Nộp lúc</th>
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
