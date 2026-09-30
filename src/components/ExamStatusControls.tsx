"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Exam } from "@/types/exam";

export function ExamStatusControls({ exam, pendingReview }: { exam: Exam; pendingReview: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function markReady() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("exams").update({ status: "ready" }).eq("id", exam.id);
    setBusy(false);
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
          onClick={markReady}
          disabled={busy}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
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
    </div>
  );
}
