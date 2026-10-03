"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";

export default function JoinExamPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/rooms/${code.trim().toUpperCase()}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_name: name, student_code: studentCode }),
    });
    const data = await res.json();
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "Có lỗi xảy ra");
      return;
    }
    router.push(`/exam/${data.session_id}`);
  }

  return (
    <AuthCard title="Vào phòng thi" subtitle="Nhập mã phòng do giáo viên cung cấp để bắt đầu">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="field-label">Mã phòng thi</label>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input-field text-center font-mono text-lg uppercase tracking-widest"
            maxLength={6}
            placeholder="ABC123"
          />
        </div>

        <div>
          <label className="field-label">Họ tên</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="input-field" />
        </div>

        <div>
          <label className="field-label">Số báo danh (giáo viên cấp)</label>
          <input
            required
            value={studentCode}
            onChange={(e) => setStudentCode(e.target.value)}
            className="input-field"
          />
          <p className="mt-1 text-xs text-slate-500">Bắt buộc — cần nhập lại đúng số này khi nộp bài.</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? "Đang vào..." : "Bắt đầu làm bài"}
        </button>
      </form>
    </AuthCard>
  );
}
