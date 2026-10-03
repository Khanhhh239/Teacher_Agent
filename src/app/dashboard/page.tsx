import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DeleteExamButton } from "@/components/DeleteExamButton";
import type { Exam, ExamStatus } from "@/types/exam";

const statusStyle: Record<ExamStatus, { label: string; className: string }> = {
  draft: { label: "Nháp", className: "bg-slate-100 text-slate-600" },
  reviewing: { label: "Đang duyệt", className: "bg-amber-100 text-amber-700" },
  ready: { label: "Sẵn sàng", className: "bg-green-100 text-green-700" },
  archived: { label: "Lưu trữ", className: "bg-slate-100 text-slate-500" },
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: exams } = await supabase
    .from("exams")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Kho đề thi</h1>
          <p className="text-sm text-slate-500">Toàn bộ đề thi bạn đã tạo.</p>
        </div>
        <Link href="/dashboard/exams/new" className="btn-primary">
          + Tạo đề thi mới
        </Link>
      </div>

      <div className="space-y-2.5">
        {(exams as Exam[] | null)?.length ? (
          (exams as Exam[]).map((exam) => {
            const status = statusStyle[exam.status];
            return (
              <div
                key={exam.id}
                className="card flex items-center justify-between p-4 transition hover:border-indigo-200 hover:shadow-md"
              >
                <Link href={`/dashboard/exams/${exam.id}`} className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{exam.title}</p>
                  <p className="text-sm text-slate-500">
                    {exam.subject || "Chưa rõ môn"} · {exam.duration_minutes} phút · Tạo lúc{" "}
                    {new Date(exam.created_at).toLocaleString("vi-VN")}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${status.className}`}>
                    {status.label}
                  </span>
                  <DeleteExamButton examId={exam.id} examTitle={exam.title} />
                </div>
              </div>
            );
          })
        ) : (
          <div className="card border-dashed p-10 text-center">
            <p className="text-sm text-slate-500">Chưa có đề thi nào. Tạo đề thi đầu tiên để bắt đầu.</p>
          </div>
        )}
      </div>
    </div>
  );
}
