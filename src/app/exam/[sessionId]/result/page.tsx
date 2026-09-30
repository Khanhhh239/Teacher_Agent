"use client";

import { use, useEffect, useState } from "react";

export default function ResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/submit`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setScore(d.total_score));
  }, [sessionId]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50">
      <h1 className="text-2xl font-semibold">Đã nộp bài thành công</h1>
      {score !== null ? (
        <p className="text-lg">
          Điểm của bạn: <span className="text-3xl font-bold">{score}</span>
        </p>
      ) : (
        <p>Đang tính điểm...</p>
      )}
      <p className="text-sm text-slate-500">Bạn có thể đóng cửa sổ này.</p>
    </div>
  );
}
