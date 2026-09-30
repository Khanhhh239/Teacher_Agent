"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ExtractedExam } from "@/types/exam";

export default function NewExamPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState(90);
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function appendLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLog([]);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Chưa đăng nhập");

      let extracted: ExtractedExam | null = null;
      if (jsonFile) {
        appendLog("Đang đọc file JSON đã trích xuất...");
        extracted = JSON.parse(await jsonFile.text());
      }

      appendLog("Đang tạo đề thi...");
      const { data: exam, error: examError } = await supabase
        .from("exams")
        .insert({
          teacher_id: user.id,
          title: title || extracted?.title || "Đề thi chưa đặt tên",
          subject: subject || extracted?.subject || "",
          duration_minutes: duration,
          status: extracted ? "reviewing" : "draft",
          source_branch: extracted?.source_branch ?? "MANUAL",
        })
        .select()
        .single();
      if (examError) throw examError;

      if (extracted) {
        // Map tên file ảnh (đường dẫn tương đối trong JSON) -> File object đã chọn
        const imageMap = new Map<string, File>();
        if (imageFiles) {
          for (const f of Array.from(imageFiles)) {
            imageMap.set(f.name, f);
            imageMap.set(`images/${f.name}`, f);
          }
        }

        appendLog(`Đang import ${extracted.questions.length} câu hỏi...`);
        for (let i = 0; i < extracted.questions.length; i++) {
          const q = extracted.questions[i];
          let imageUrl: string | null = null;

          if (q.image_url) {
            const localFile = imageMap.get(q.image_url);
            if (localFile) {
              const path = `${exam.id}/${crypto.randomUUID()}-${localFile.name}`;
              const { error: uploadError } = await supabase.storage
                .from("exam-images")
                .upload(path, localFile);
              if (uploadError) throw uploadError;
              const { data: pub } = supabase.storage.from("exam-images").getPublicUrl(path);
              imageUrl = pub.publicUrl;
            } else if (q.image_url.startsWith("http")) {
              imageUrl = q.image_url;
            }
          }

          const { error: qError } = await supabase.from("questions").insert({
            exam_id: exam.id,
            order_index: i,
            type: q.type,
            content_latex: q.content_latex,
            image_url: imageUrl,
            options: q.options,
            sub_statements: q.sub_statements,
            correct_answer: q.correct_answer,
            short_answer_normalized: q.short_answer_normalized,
            score_rule: q.score_rule,
            max_score: q.max_score,
            raw_ocr_notes: q.raw_ocr_notes,
            needs_review: true,
          });
          if (qError) throw qError;
          appendLog(`  Câu ${i + 1}/${extracted.questions.length} OK`);
        }
      }

      appendLog("Hoàn tất! Đang chuyển tới trang duyệt câu hỏi...");
      router.push(`/dashboard/exams/${exam.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Tạo đề thi mới</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Tên đề thi</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Đề thi thử THPT 2026 - Mã 0101"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Môn học</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
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

        <hr />

        <div>
          <p className="mb-2 text-sm font-medium">
            Import từ pipeline trích xuất (tuỳ chọn) — chạy{" "}
            <code className="rounded bg-slate-100 px-1">pipeline/extract.py</code> trước để có
            file JSON + thư mục ảnh.
          </p>
          <label className="mb-1 block text-sm">File JSON đã trích xuất</label>
          <input
            type="file"
            accept="application/json"
            onChange={(e) => setJsonFile(e.target.files?.[0] ?? null)}
            className="mb-3 block w-full text-sm"
          />
          <label className="mb-1 block text-sm">Ảnh minh họa (chọn tất cả file trong thư mục images/)</label>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => setImageFiles(e.target.files)}
            className="block w-full text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {log.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md bg-slate-50 p-2 text-xs text-slate-600">
            {log.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Đang xử lý..." : "Tạo đề thi"}
        </button>
      </form>
    </div>
  );
}
