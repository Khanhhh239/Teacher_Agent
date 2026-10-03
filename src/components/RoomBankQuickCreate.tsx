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
      <div className="card border-dashed p-4 text-sm text-slate-500">
        Chưa có đề thi nào ở trạng thái "Sẵn sàng" để tạo phòng. Vào tab{" "}
        <span className="font-medium text-slate-700">Kho đề thi</span>, duyệt xong một đề rồi quay
        lại đây.
      </div>
    );
  }

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-1 flex-col gap-1 text-sm text-slate-700">
        Chọn đề thi để tạo phòng
        <select value={examId} onChange={(e) => setExamId(e.target.value)} className="input-field">
          {readyExams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => router.push(`/dashboard/exams/${examId}/rooms`)} className="btn-primary">
        + Tạo phòng thi mới
      </button>
    </div>
  );
}
