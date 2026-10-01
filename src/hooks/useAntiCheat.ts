"use client";

import { useEffect, useRef } from "react";
import type { ViolationType } from "@/types/exam";

/**
 * Anti-cheat mức "deterrent + logging": chặn được thao tác phổ thông (chuột phải, Ctrl+C/V,
 * phím tắt DevTools phổ biến) và ghi log tab-switch/thoát fullscreen. KHÔNG chặn được 100%
 * người rành kỹ thuật (vẫn có thể mở DevTools qua menu trình duyệt hoặc userscript) — mục
 * đích là giảm thiểu gian lận thông thường + cung cấp bằng chứng cho giáo viên xem lại.
 */
export function useAntiCheat(
  sessionId: string,
  enabled: boolean,
  requireFullscreen: boolean,
  onKicked?: () => void
) {
  const violationCountRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function logViolation(type: ViolationType, meta: Record<string, unknown> = {}) {
      violationCountRef.current += 1;
      fetch(`/api/sessions/${sessionId}/violation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, meta }),
        keepalive: true,
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.kicked) onKicked?.();
        })
        .catch(() => {});
    }

    function handleVisibilityChange() {
      if (document.hidden) logViolation("tab_blur");
    }

    function handleBlur() {
      logViolation("tab_blur");
    }

    function handleFullscreenChange() {
      if (requireFullscreen && !document.fullscreenElement) {
        logViolation("fullscreen_exit");
      }
    }

    function handleContextMenu(e: MouseEvent) {
      e.preventDefault();
      logViolation("right_click");
    }

    function handleKeyDown(e: KeyboardEvent) {
      const isDevtoolsKey =
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase())) ||
        (e.ctrlKey && e.key.toUpperCase() === "U");
      const isCopyPaste = e.ctrlKey && ["C", "V", "X"].includes(e.key.toUpperCase());
      const isPrint = e.ctrlKey && e.key.toUpperCase() === "P";

      if (isDevtoolsKey || isPrint) {
        e.preventDefault();
        logViolation("devtools_key", { key: e.key });
      } else if (isCopyPaste) {
        e.preventDefault();
        logViolation("copy_paste", { key: e.key });
      }
    }

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeunload", handleBeforeUnload);

    if (requireFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [sessionId, enabled, requireFullscreen, onKicked]);
}
