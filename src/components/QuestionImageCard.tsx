"use client";

import { memo } from "react";

/** 1 câu hỏi = 1 ảnh gốc cắt từ PDF (đã xóa số câu gốc) — không còn chép lại thành chữ, nên
 * không còn lỗi mất ký hiệu khi OCR. Số câu hiển thị ("Câu N") là số VỊ TRÍ sau khi xáo trộn,
 * web tự in ra ngoài ảnh, không phải số in sẵn trong PDF. */
function QuestionImageCardImpl({
  number,
  partLabel,
  showPartHeader,
  imageUrl,
  extra,
}: {
  number: number;
  partLabel?: string | null;
  showPartHeader?: boolean;
  imageUrl: string | null;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      {showPartHeader && partLabel && (
        <h2 className="mb-2 mt-4 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-bold text-indigo-700">{partLabel}</h2>
      )}
      <div className="card p-3">
        <p className="mb-2 inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
          Câu {number}
        </p>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={`Câu ${number}`} loading="lazy" decoding="async" className="w-full rounded border bg-white" />
        ) : (
          <p className="rounded border border-dashed p-6 text-center text-sm text-slate-400">Chưa có ảnh câu hỏi</p>
        )}
        {extra}
      </div>
    </div>
  );
}

// Re-render toàn bộ cha mỗi lần học sinh bấm 1 đáp án (state ở TakeExamPage) không nên kéo
// theo việc tính lại ảnh của TẤT CẢ các câu khác — ảnh/nhãn của 1 câu không đổi khi câu khác
// được trả lời, nên memo hoá để giữ nguyên DOM ảnh, tránh giật khi bấm trên đề nhiều câu.
export const QuestionImageCard = memo(QuestionImageCardImpl);
