"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Chia đôi màn hình trái/phải với 1 thanh kéo ở giữa — dùng để giáo viên đối chiếu đề đã
 * trích xuất (trái) với file đề gốc (phải) khi duyệt. Kéo được từ gần 0% (thu gọn gần hết
 * bên phải) tới gần 100% (bên phải chiếm gần hết màn hình).
 */
export function ResizableSplitView({
  left,
  right,
  initialRightWidthPct = 40,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  initialRightWidthPct?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rightWidthPct, setRightWidthPct] = useState(initialRightWidthPct);
  const draggingRef = useRef(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((rect.right - e.clientX) / rect.width) * 100;
    setRightWidthPct(Math.min(96, Math.max(4, pct)));
  }, []);

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  function startDrag() {
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full">
      <div className="min-w-0 flex-1 overflow-y-auto pr-3" style={{ flexBasis: `${100 - rightWidthPct}%` }}>
        {left}
      </div>
      <div
        onPointerDown={startDrag}
        className="group relative mx-1 w-2.5 shrink-0 cursor-col-resize select-none rounded bg-slate-100 hover:bg-slate-300 active:bg-slate-400"
        title="Kéo sang trái/phải để thu/giãn khung"
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-0.5">
          <div className="flex flex-col gap-1">
            <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
            <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
            <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
            <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
            <span className="h-1 w-1 rounded-full bg-slate-400 group-hover:bg-slate-600" />
          </div>
        </div>
      </div>
      <div
        className="min-w-0 shrink-0 overflow-y-auto pl-3"
        style={{ flexBasis: `${rightWidthPct}%` }}
      >
        {right}
      </div>
    </div>
  );
}
