"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Vào phòng thi</h1>

        <div>
          <label className="mb-1 block text-sm font-medium">Mã phòng thi</label>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-center font-mono text-lg uppercase tracking-widest"
            maxLength={6}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Họ tên</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Số báo danh (giáo viên cấp)</label>
          <input
            required
            value={studentCode}
            onChange={(e) => setStudentCode(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">Bắt buộc — cần nhập lại đúng số này khi nộp bài.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Đang vào..." : "Bắt đầu làm bài"}
        </button>
      </form>
    </div>
  );
}
