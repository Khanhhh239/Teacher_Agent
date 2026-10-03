"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function RoomActiveToggle({ roomId, isActive }: { roomId: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("exam_rooms").update({ is_active: !isActive }).eq("id", roomId);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        isActive ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
      }`}
    >
      {isActive ? "Đang mở" : "Đã đóng"}
    </button>
  );
}
