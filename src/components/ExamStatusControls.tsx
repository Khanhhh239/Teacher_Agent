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

  async function markReady() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("exams").update({ status: "ready" }).eq("id", exam.id);
    setBusy(false);
    setShowPreview(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {pendingReview > 0 ? (
        <span className="text-sm text-amber-700">
          Còn {pendingReview} câu chưa duyệt — phải duyệt hết trước khi tạo phòng thi.
        </span>
      ) : exam.status !== "ready" ? (
        <button
          onClick={() => setShowPreview(true)}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          Đánh dấu sẵn sàng
        </button>
      ) : (
        <Link
          href={`/dashboard/exams/${exam.id}/rooms`}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
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
