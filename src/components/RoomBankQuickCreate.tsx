"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Exam } from "@/types/exam";

/** Chọn 1 đề từ kho (chỉ đề đã "Sẵn sàng") rồi chuyển sang trang quản lý phòng của đề đó để
 * tạo phòng — tái dùng y nguyên form tạo phòng đã có (khung giờ, số lần làm bài, vi phạm...)
 * thay vì nhân đôi logic tạo phòng ở đây. */
export function RoomBankQuickCreate({ readyExams }: { readyExams: Exam[] }) {
  const router = useRouter();
  const [examId, setExamId] = useState(readyExams[0]?.id ?? "");

  if (readyExams.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-white p-4 text-sm text-slate-500">
        Chưa có đề thi nào ở trạng thái "Sẵn sàng" để tạo phòng. Vào tab{" "}
        <span className="font-medium text-slate-700">Kho đề thi</span>, duyệt xong một đề rồi quay
        lại đây.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        Chọn đề thi để tạo phòng
        <select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {readyExams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => router.push(`/dashboard/exams/${examId}/rooms`)}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      >
        + Tạo phòng thi mới
      </button>
    </div>
  );
}
