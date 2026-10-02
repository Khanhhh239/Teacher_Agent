"use client";

/**
 * Hiển thị file đề gốc để giáo viên đối chiếu. PDF và ảnh render được trực tiếp trong
 * trình duyệt. File .docx trình duyệt không tự render được (giới hạn chung của mọi trình
 * duyệt) — nhưng server đã tự convert .docx sang PDF qua CloudConvert lúc upload (xem
 * extract-upload/route.ts) để làm bản xem trước (previewUrl), nên vẫn hiển thị được
 * y hệt bản gốc. Chỉ khi convert thất bại mới rơi về link tải file .docx.
 */
export function OriginalFileViewer({
  url,
  ext,
  previewUrl,
}: {
  url: string | null;
  ext: string | null;
  previewUrl?: string | null;
}) {
  if (!url) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
        Đề thi này chưa lưu file gốc (upload từ trước khi có tính năng này).
      </div>
    );
  }

  if (ext === "pdf") {
    return <iframe src={url} className="h-full min-h-[70vh] w-full rounded-lg border" title="Đề gốc (PDF)" />;
  }

  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="Đề gốc" className="w-full rounded-lg border" />;
  }

  if (previewUrl) {
    return (
      <div className="flex h-full min-h-[70vh] flex-col gap-2">
        <iframe src={previewUrl} className="h-full min-h-[70vh] w-full rounded-lg border" title="Đề gốc (bản xem trước PDF)" />
        <a href={url} download className="self-start text-xs text-slate-500 underline hover:text-slate-700">
          Tải file .docx gốc nguyên bản
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
      <p>
        Không tạo được bản xem trước cho file .docx gốc (lỗi convert) — trình duyệt không hiển thị trực tiếp được file
        Word.
      </p>
      <a href={url} download className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
        Tải file gốc về xem
      </a>
    </div>
  );
}
