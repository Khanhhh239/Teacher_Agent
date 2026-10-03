import type { ViolationType } from "@/types/exam";

export const VIOLATION_LABELS: Record<ViolationType, string> = {
  tab_blur: "Chuyển tab / mất focus cửa sổ",
  fullscreen_exit: "Thoát toàn màn hình",
  devtools_key: "Bấm phím mở DevTools / In trang",
  copy_paste: "Copy / Paste",
  right_click: "Click chuột phải",
  window_resize: "Thay đổi kích thước cửa sổ",
};
