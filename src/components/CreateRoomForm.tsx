"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ ký tự dễ nhầm (0,O,1,I)
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function CreateRoomForm({ examId }: { examId: string }) {
  const router = useRouter();
  const [requireFullscreen, setRequireFullscreen] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [violationKickLimit, setViolationKickLimit] = useState(1);
  const [limitWindow, setLimitWindow] = useState(false);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("exam_rooms").insert({
      exam_id: examId,
      code: randomCode(),
      require_fullscreen: requireFullscreen,
      max_attempts: Math.max(1, maxAttempts),
      violation_kick_limit: Math.max(1, violationKickLimit),
      opens_at: limitWindow && opensAt ? new Date(opensAt).toISOString() : null,
      closes_at: limitWindow && closesAt ? new Date(closesAt).toISOString() : null,
      is_active: true,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={requireFullscreen}
          onChange={(e) => setRequireFullscreen(e.target.checked)}
        />
        Bắt buộc toàn màn hình + ghi log vi phạm (khuyến nghị)
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={limitWindow} onChange={(e) => setLimitWindow(e.target.checked)} />
        Giới hạn khung giờ được VÀO phòng thi (khác với thời lượng làm bài của đề — học sinh có
        thể cần thời gian chuẩn bị trước khi bắt đầu tính giờ)
      </label>
      {limitWindow && (
        <div className="mb-3 flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Mở phòng từ
            <input
              type="datetime-local"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Đóng phòng lúc
            <input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          Số lần làm bài tối đa
          <input
            type="number"
            min={1}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Number(e.target.value))}
            className="w-16 rounded border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Số vi phạm thì tự động đuổi khỏi phòng
          <input
            type="number"
            min={1}
            value={violationKickLimit}
            onChange={(e) => setViolationKickLimit(Number(e.target.value))}
            className="w-16 rounded border px-2 py-1"
          />
        </label>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <button
        onClick={handleCreate}
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Đang tạo..." : "+ Tạo phòng thi mới"}
      </button>
    </div>
  );
}
