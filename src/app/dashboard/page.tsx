import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Exam } from "@/types/exam";

const statusLabel: Record<string, string> = {
  draft: "Nháp",
  reviewing: "Đang duyệt",
  ready: "Sẵn sàng",
  archived: "Lưu trữ",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: exams } = await supabase
    .from("exams")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Đề thi của tôi</h1>
        <Link
          href="/dashboard/exams/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          + Tạo đề thi mới
        </Link>
      </div>

      <div className="space-y-2">
        {(exams as Exam[] | null)?.length ? (
          (exams as Exam[]).map((exam) => (
            <Link
              key={exam.id}
              href={`/dashboard/exams/${exam.id}`}
              className="flex items-center justify-between rounded-lg border bg-white p-4 hover:bg-slate-50"
            >
              <div>
                <p className="font-medium">{exam.title}</p>
                <p className="text-sm text-slate-500">
                  {exam.subject || "Chưa rõ môn"} · {exam.duration_minutes} phút
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                {statusLabel[exam.status] ?? exam.status}
              </span>
            </Link>
          ))
        ) : (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
            Chưa có đề thi nào. Tạo đề thi đầu tiên để bắt đầu.
          </p>
        )}
      </div>
    </div>
  );
}
