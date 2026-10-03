"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const EXAM_ACCEPTED_EXTS = ["pdf"];
const ANSWER_ACCEPTED_EXTS = ["docx", "pdf", "jpg", "jpeg", "png", "webp"];

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function Dropzone({
  label,
  hint,
  accept,
  file,
  onPick,
}: {
  label: string;
  hint: string;
  accept: string;
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
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? "border-indigo-500 bg-indigo-50" : file ? "border-green-300 bg-green-50/50" : "border-slate-300 hover:border-indigo-300 hover:bg-indigo-50/30"
        }`}
      >
        <svg
          className={`h-8 w-8 ${file ? "text-green-500" : "text-slate-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          {file ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
            />
          )}
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
          accept={accept}
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

  function pickFile(setter: (f: File | null) => void, f: File | null, accepted: string[], errorMsg: string) {
    if (!f) return;
    if (!accepted.includes(extOf(f.name))) {
      setError(errorMsg);
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
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
        <p className="text-slate-600">
          Đang cắt ảnh từng câu từ đề và đọc file đáp án (thường dưới 1 phút)...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Tạo đề thi mới</h1>
      <p className="mb-4 text-sm text-slate-500">Upload file đề (PDF) và file đáp án để hệ thống tự cắt từng câu.</p>

      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Dropzone
            label="1. File đề thi"
            hint="Chỉ nhận .pdf (xuất từ Word)"
            accept=".pdf"
            file={file}
            onPick={(f) => pickFile(setFile, f, EXAM_ACCEPTED_EXTS, "File đề thi chỉ chấp nhận định dạng PDF (trong Word: File → Save As → PDF).")}
          />
          <Dropzone
            label="2. File đáp án"
            hint=".docx, .pdf hoặc ảnh chụp"
            accept=".docx,.pdf,.jpg,.jpeg,.png,.webp"
            file={answerFile}
            onPick={(f) => pickFile(setAnswerFile, f, ANSWER_ACCEPTED_EXTS, "File đáp án chỉ chấp nhận .docx, .pdf hoặc ảnh (.jpg/.png/.webp).")}
          />
        </div>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
          File đề thi dùng thẳng ẢNH GỐC cắt từ PDF làm nội dung câu hỏi (không chép lại thành chữ) để không còn lỗi
          đọc sai công thức — vì vậy chỉ nhận file .pdf xuất từ Word, có lớp chữ thật (File → Save As → PDF). File đáp
          án vẫn đọc bằng AI như trước, chấp nhận .docx/.pdf/ảnh. Loại câu và đáp án đúng lấy từ file đáp án; câu nào
          thiếu đáp án sẽ cần giáo viên tự chọn ở bước duyệt.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Môn học (tuỳ chọn)</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Hệ thống sẽ tự nhận diện nếu để trống"
              className="input-field"
            />
          </div>
          <div>
            <label className="field-label">Thời gian (phút)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="input-field"
            />
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {warnings.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {warnings.map((w, i) => (
              <p key={i}>⚠ {w}</p>
            ))}
          </div>
        )}

        <button type="submit" disabled={!file || !answerFile} className="btn-primary">
          Tiếp tục
        </button>
      </form>
    </div>
  );
}
