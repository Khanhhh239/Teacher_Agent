"use client";

export function ExportCsvButton({
  filename,
  rows,
}: {
  filename: string;
  rows: (string | number)[][];
}) {
  function download() {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    // ﻿: BOM giúp Excel mở file tiếng Việt UTF-8 không bị lỗi font
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button onClick={download} className="rounded-md border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
      Xuất file kết quả (CSV)
    </button>
  );
}
