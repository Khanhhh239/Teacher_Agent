"use client";

import { QuestionAnswerSplit, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import type { Exam, Question } from "@/types/exam";

export function ExamPreviewModal({
  exam,
  questions,
  busy,
  onClose,
  onConfirm,
}: {
  exam: Exam;
  questions: Question[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const splitQuestions: SplitQuestion[] = questions.map((q, idx) => ({
    id: q.id,
    number: idx + 1,
    part_label: q.part_label,
    source_crop_url: q.source_crop_url ?? null,
    type: q.type,
    optionKeys: q.options.map((o) => o.key),
    subKeys: q.sub_statements.map((s) => s.key),
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Xem trước đề thi</h2>
            <p className="text-sm text-slate-500">Đây là giao diện học sinh sẽ thấy — kiểm tra lại lần cuối trước khi xác nhận.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
          <div className="mb-3 shrink-0">
            <h1 className="font-semibold text-slate-900">{exam.title}</h1>
            <p className="text-sm text-slate-500">
              {exam.subject} · {exam.duration_minutes} phút · {questions.length} câu
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <QuestionAnswerSplit questions={splitQuestions} values={{}} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-4">
          <button onClick={onClose} disabled={busy} className="btn-secondary">
            Quay lại chỉnh sửa
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Đang xác nhận..." : "Xác nhận tạo đề thi"}
          </button>
        </div>
      </div>
    </div>
  );
}
