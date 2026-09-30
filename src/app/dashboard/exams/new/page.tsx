"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewExamPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function pickFile(f: File | null) {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx" && ext !== "pdf") {
      setError("Chỉ chấp nhận file .docx hoặc .pdf");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Vui lòng chọn file đề thi (.docx hoặc .pdf)");
      return;
    }
    setBusy(true);
    setError(null);
    setWarnings([]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("duration_minutes", String(duration));

      const res = await fetch("/api/exams/extract-upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Có lỗi xảy ra khi xử lý file");
        setBusy(false);
        return;
      }

      if (data.warnings?.length) setWarnings(data.warnings);
      router.push(`/dashboard/exams/${data.exam_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
        <p className="text-slate-600">
          Đang đọc và trích xuất đề thi (30–60 giây tuỳ độ dài file)...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Tạo đề thi mới</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-5">
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <svg
            className="h-10 w-10 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
            />
          </svg>
          {file ? (
            <p className="font-medium text-slate-900">{file.name}</p>
          ) : (
            <>
              <p className="font-medium text-slate-700">Kéo thả file vào đây, hoặc bấm để chọn</p>
              <p className="text-sm text-slate-500">Hỗ trợ file .docx hoặc .pdf (đề thi + đáp án)</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Môn học (tuỳ chọn)</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Hệ thống sẽ tự nhận diện nếu để trống"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Thời gian (phút)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {warnings.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
            {warnings.map((w, i) => (
              <p key={i}>⚠ {w}</p>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={!file}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Tải lên & trích xuất
        </button>
      </form>
    </div>
  );
}
