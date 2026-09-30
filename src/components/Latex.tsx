"use client";

import "katex/dist/katex.min.css";
import { InlineMath } from "react-katex";

/**
 * Render nội dung chứa LaTeX trộn với văn bản thường.
 * Quy ước: công thức được bọc trong $...$ (khớp với output pipeline).
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
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
