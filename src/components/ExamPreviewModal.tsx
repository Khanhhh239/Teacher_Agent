"use client";

import { LatexText } from "@/components/Latex";
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold">Xem trước đề thi</h2>
            <p className="text-sm text-slate-500">Đây là giao diện học sinh sẽ thấy — kiểm tra lại lần cuối trước khi xác nhận.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="mb-4 border-b pb-3">
            <h1 className="font-semibold">{exam.title}</h1>
            <p className="text-sm text-slate-500">
              {exam.subject} · {exam.duration_minutes} phút · {questions.length} câu
            </p>
          </div>

          <div className="space-y-4">
            {questions.map((q, idx) => {
              const prevPart = idx > 0 ? questions[idx - 1].part_label : null;
              const showPartHeader = q.part_label && q.part_label !== prevPart;
              return (
              <div key={q.id}>
                {showPartHeader && <h2 className="mb-2 mt-2 font-bold">{q.part_label}</h2>}
                <div className="rounded-lg border p-4">
                <p className="mb-3">
                  <span className="font-bold">Câu {idx + 1}.</span> <LatexText text={q.content_latex} />
                </p>
                {q.image_urls.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {q.image_urls.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" className="max-h-72 rounded border" />
                    ))}
                  </div>
                )}

                {q.type === "multiple_choice" && (
                  <div className="space-y-2">
                    {q.options.map((o) => (
                      <div key={o.key} className="rounded-md border p-2 text-sm">
                        <span className="font-medium">{o.key}.</span> <LatexText text={o.text_latex} />
                      </div>
                    ))}
                  </div>
                )}

                {q.type === "true_false_group" && (
                  <div className="space-y-2">
                    {q.sub_statements.map((s) => (
                      <div key={s.key} className="rounded-md border p-2 text-sm">
                        {s.key}) <LatexText text={s.text_latex} />
                      </div>
                    ))}
                  </div>
                )}

                {q.type === "short_answer" && (
                  <div className="rounded-md border border-dashed p-2 text-sm text-slate-400">
                    Học sinh nhập đáp án tại đây
                  </div>
                )}
                </div>
              </div>
              );
            })}
            {!questions.length && (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
                Đề thi chưa có câu hỏi nào.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            Quay lại chỉnh sửa
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Đang xác nhận..." : "Xác nhận tạo đề thi"}
          </button>
        </div>
      </div>
    </div>
  );
}
