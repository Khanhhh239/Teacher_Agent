"use client";

/**
 * Hiển thị file đề gốc để giáo viên đối chiếu — PDF và ảnh render được trực tiếp trong
 * trình duyệt. File .docx trình duyệt không tự render được (không phải lỗi, giới hạn
 * chung của mọi trình duyệt), nên chỉ đưa link tải về mở bằng Word.
 */
export function OriginalFileViewer({ url, ext }: { url: string | null; ext: string | null }) {
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

  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
      <p>
        File .docx gốc — trình duyệt không hiển thị trực tiếp được file Word (giới hạn chung, không riêng hệ thống
        này).
      </p>
      <a href={url} download className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
        Tải file gốc về xem
      </a>
    </div>
  );
}
