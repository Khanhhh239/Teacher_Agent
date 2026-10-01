"use client";

import "katex/dist/katex.min.css";
import { InlineMath } from "react-katex";

const MISSING_FORMULA_RE = /\[CT\?(\d+)\]/g;

function renderPlainText(text: string, keyPrefix: string | number) {
  const segments = text.split(MISSING_FORMULA_RE);
  // split với regex có capture group trả về: [text, số, text, số, ...]
  return segments.map((seg, i) => {
    if (i % 2 === 1) {
      return (
        <span
          key={`${keyPrefix}-ct-${i}`}
          title="Công thức MathType cũ chưa nhận dạng được — bấm Sửa để tự nhập LaTeX"
          className="mx-0.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-800"
        >
          ⚠ CT #{seg}
        </span>
      );
    }
    return seg ? <span key={`${keyPrefix}-txt-${i}`}>{seg}</span> : null;
  });
}

/**
 * Render nội dung chứa LaTeX trộn với văn bản thường.
 * Quy ước: công thức được bọc trong $...$ (khớp với output pipeline).
 * Marker [CT?N] (công thức MathType cũ chưa OCR được) hiển thị thành 1 thẻ cảnh báo nhỏ
 * gọn thay vì để nguyên dạng ngoặc vuông thô — xem src/lib/extraction/docxExtract.ts.
 */
export function LatexText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("$") && part.endsWith("$") && part.length > 1) {
          const formula = part.slice(1, -1);
          try {
            return <InlineMath key={i} math={formula} />;
          } catch {
            return <span key={i}>{part}</span>;
          }
        }
        return <span key={i}>{renderPlainText(part, i)}</span>;
      })}
    </>
  );
}
