"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ACCEPTED_EXTS = ["docx", "pdf", "jpg", "jpeg", "png", "webp"];

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function Dropzone({
  label,
  hint,
  file,
  onPick,
}: {
  label: string;
  hint: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onPick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
          />
        </svg>
        {file ? (
          <p className="text-sm font-medium text-slate-900">{file.name}</p>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">Kéo thả vào đây, hoặc bấm để chọn</p>
            <p className="text-xs text-slate-500">{hint}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </div>
    </div>
  );
}

export default function NewExamPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function pickFile(setter: (f: File | null) => void, f: File | null) {
    if (!f) return;
    if (!ACCEPTED_EXTS.includes(extOf(f.name))) {
      setError("Chỉ chấp nhận file .docx, .pdf hoặc ảnh (.jpg/.png/.webp)");
      return;
    }
    setError(null);
    setter(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !answerFile) {
      setError("Vui lòng chọn cả file đề thi và file đáp án.");
      return;
    }
    setBusy(true);
    setError(null);
    setWarnings([]);

    try {
      // Upload thẳng lên Supabase Storage từ trình duyệt (không qua body của Vercel
      // function) để tránh giới hạn ~4.5MB request body của Vercel Hobby — chỉ gửi
      // đường dẫn storage (rất nhỏ) tới API route, route sẽ tự tải file về xử lý.
      const supabase = createClient();
      const batchId = crypto.randomUUID();

      async function uploadTmp(f: File, slot: "exam" | "answer") {
        const ext = extOf(f.name);
        const path = `tmp-uploads/${batchId}/${slot}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("exam-images").upload(path, f, {
          contentType: f.type || undefined,
        });
        if (uploadError) throw new Error(`Upload file ${slot === "exam" ? "đề thi" : "đáp án"} thất bại: ${uploadError.message}`);
        return path;
      }

      const [filePath, answerFilePath] = await Promise.all([
        uploadTmp(file, "exam"),
        uploadTmp(answerFile, "answer"),
      ]);

      const res = await fetch("/api/exams/extract-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: filePath,
          file_name: file.name,
          answer_file_path: answerFilePath,
          answer_file_name: answerFile.name,
          duration_minutes: duration,
        }),
      });
      // Nếu server timeout (Vercel vượt maxDuration) hoặc gặp lỗi hạ tầng, phản hồi có thể
      // là trang lỗi HTML/text thay vì JSON — tránh để JSON.parse ném lỗi "Unexpected
      // token..." khó hiểu, hiện thông báo rõ ràng thay thế.
      const rawText = await res.text();
      let data: { error?: string; warnings?: string[]; exam_id?: string } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        setError(
          res.status === 504 || !res.ok
            ? "Xử lý đề thi mất quá nhiều thời gian hoặc máy chủ gặp sự cố — thường do đề có nhiều công thức/trang. Vui lòng thử lại; nếu vẫn lỗi, thử tách đề thành phần nhỏ hơn hoặc liên hệ hỗ trợ."
            : "Phản hồi từ máy chủ không hợp lệ — vui lòng thử lại."
        );
        setBusy(false);
        return;
      }

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
          Đang đọc đề thi và đáp án, ghép đáp án vào từng câu (có thể mất 1-2 phút)...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Tạo đề thi mới</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Dropzone
            label="1. File đề thi"
            hint=".docx, .pdf hoặc ảnh chụp"
            file={file}
            onPick={(f) => pickFile(setFile, f)}
          />
          <Dropzone
            label="2. File đáp án"
            hint=".docx, .pdf hoặc ảnh chụp"
            file={answerFile}
            onPick={(f) => pickFile(setAnswerFile, f)}
          />
        </div>
        <p className="text-xs text-slate-500">
          Cần upload cả 2 file — hệ thống sẽ tự đọc đáp án và điền sẵn vào từng câu (đánh dấu màu đỏ), bạn chỉ cần kiểm
          tra lại và sửa nếu AI đọc sai. Nếu file .docx dùng công thức MathType/Equation cũ (phổ biến ở file soạn từ
          lâu), hệ thống sẽ từ chối và yêu cầu bạn Save As sang PDF trong Word trước khi upload lại.
        </p>

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
          disabled={!file || !answerFile}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Tiếp tục
        </button>
      </form>
    </div>
  );
}
