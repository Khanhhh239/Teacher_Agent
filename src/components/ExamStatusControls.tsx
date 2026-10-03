"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ExamPreviewModal } from "@/components/ExamPreviewModal";
import type { Exam, Question } from "@/types/exam";

export function ExamStatusControls({
  exam,
  questions,
  pendingReview,
}: {
  exam: Exam;
  questions: Question[];
  pendingReview: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Câu chưa đọc được tự động (extraction_meta.blocking) phải được giáo viên sửa/lưu trước.
  const blockingCount = questions.filter((q) => q.extraction_meta?.blocking).length;

  async function markReady() {
    setBusy(true);
    const supabase = createClient();
    // Xem trước toàn bộ đề trong modal đã đóng vai trò là bước duyệt — không bắt giáo
    // viên phải bấm "đã duyệt" từng câu riêng lẻ nữa (tốn thời gian với đề 20+ câu).
    // Xác nhận ở preview coi như duyệt hết mọi câu cùng lúc.
    await supabase.from("questions").update({ needs_review: false }).eq("exam_id", exam.id);
    await supabase.from("exams").update({ status: "ready" }).eq("id", exam.id);
    setBusy(false);
    setShowPreview(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {exam.status !== "ready" ? (
        <>
          {pendingReview > 0 && (
            <span className="text-sm text-slate-500">{pendingReview} câu có thể cần xem lại kỹ hơn.</span>
          )}
          {blockingCount > 0 && (
            <span className="text-sm font-medium text-red-600">
              ⛔ Còn {blockingCount} câu chưa đọc được tự động — sửa và bấm Xác nhận từng câu đó trước.
            </span>
          )}
          <button
            onClick={() => setShowPreview(true)}
            disabled={blockingCount > 0}
            title={blockingCount > 0 ? "Còn câu chưa đọc được, cần xử lý trước" : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Xem trước &amp; Đánh dấu sẵn sàng
          </button>
        </>
      ) : (
        <Link href={`/dashboard/exams/${exam.id}/rooms`} className="btn-primary">
          Quản lý phòng thi →
        </Link>
      )}

      {showPreview && (
        <ExamPreviewModal
          exam={exam}
          questions={questions}
          busy={busy}
          onClose={() => setShowPreview(false)}
          onConfirm={markReady}
        />
      )}
    </div>
  );
}
