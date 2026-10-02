"use client";

import { useState } from "react";
import type { ExtractionMeta } from "@/types/exam";

/** Phần phụ hiển thị dưới ảnh câu hỏi: cờ cảnh báo của bước số hóa + nút thay ảnh (nếu bị cắt
 * sai) — dùng làm `renderImageExtra` cho QuestionAnswerSplit ở trang duyệt của giáo viên. */
export function QuestionExtras({
  meta,
  onReplaceImage,
}: {
  meta: ExtractionMeta | null | undefined;
  onReplaceImage: (file: File) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    await onReplaceImage(file);
    setUploading(false);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) handleFile(file);
  }

  return (
    <div className="mt-2" tabIndex={0} onPaste={handlePaste}>
      {meta && meta.flags.length > 0 && (
        <div
          className={`mb-2 rounded-md border p-2 text-xs ${
            meta.blocking ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="mb-1 font-semibold">{meta.blocking ? "⛔ Cần xử lý:" : "⚠ Cần soát kỹ:"}</p>
          <ul className="ml-4 list-disc space-y-0.5">
            {meta.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="inline-block cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
        {uploading ? "Đang tải..." : "Ảnh sai? Bấm chọn lại (hoặc bấm vào đây rồi Ctrl+V)"}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
    </div>
  );
}
