"use client";

/** 1 câu hỏi = 1 ảnh gốc cắt từ PDF (đã xóa số câu gốc) — không còn chép lại thành chữ, nên
 * không còn lỗi mất ký hiệu khi OCR. Số câu hiển thị ("Câu N") là số VỊ TRÍ sau khi xáo trộn,
 * web tự in ra ngoài ảnh, không phải số in sẵn trong PDF. */
export function QuestionImageCard({
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
      {showPartHeader && partLabel && <h2 className="mb-2 mt-3 font-bold">{partLabel}</h2>}
      <div className="rounded-lg border bg-white p-3">
        <p className="mb-2 text-xs font-bold text-slate-500">Câu {number}</p>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={`Câu ${number}`} className="w-full rounded border bg-white" />
        ) : (
          <p className="rounded border border-dashed p-6 text-center text-sm text-slate-400">Chưa có ảnh câu hỏi</p>
        )}
        {extra}
      </div>
    </div>
  );
}
