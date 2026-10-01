"use client";

import "katex/dist/katex.min.css";
import { InlineMath } from "react-katex";

const MISSING_FORMULA_RE = /\[CT\?(\d+)\]/g;

function renderInlineSegments(text: string, keyPrefix: string | number) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return parts.map((part, i) => {
    if (part.startsWith("$") && part.endsWith("$") && part.length > 1) {
      const formula = part.slice(1, -1);
      try {
        return <InlineMath key={`${keyPrefix}-m-${i}`} math={formula} />;
      } catch {
        return <span key={`${keyPrefix}-m-${i}`}>{part}</span>;
      }
    }
    return <span key={`${keyPrefix}-t-${i}`}>{renderPlainText(part, `${keyPrefix}-${i}`)}</span>;
  });
}

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

/** Bảng Markdown dạng `| A | B |` + dòng phân cách `| --- | --- |` — định dạng LLM được
 * yêu cầu dùng cho mọi bảng số liệu (xem STRUCTURE_PROMPT trong llmClient.ts). */
function parseMarkdownTable(lines: string[], start: number): { rows: string[][]; next: number } | null {
  if (!lines[start]?.trim().startsWith("|")) return null;
  const sepLine = lines[start + 1]?.trim() ?? "";
  if (!/^\|?[\s:|-]+\|?$/.test(sepLine) || !sepLine.includes("-")) return null;

  const rows: string[][] = [];
  let i = start;
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    if (i !== start + 1) {
      const cells = lines[i]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      rows.push(cells);
    }
    i++;
  }
  return { rows, next: i };
}

/** LaTeX \begin{tabular}...\end{tabular} — KaTeX KHÔNG hỗ trợ môi trường bảng, một số
 * phiên bản output cũ (trước khi prompt yêu cầu Markdown) có thể vẫn còn dạng này. */
function parseLatexTabular(block: string): string[][] | null {
  const inner = block.replace(/\\hline/g, "");
  const rows = inner
    .split("\\\\")
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => r.split("&").map((c) => c.trim()));
  return rows.length ? rows : null;
}

function Table({ rows, keyPrefix }: { rows: string[][]; keyPrefix: string | number }) {
  return (
    <table className="my-2 border-collapse border border-slate-300 text-sm">
      <tbody>
        {rows.map((row, ri) => (
          <tr key={`${keyPrefix}-r-${ri}`}>
            {row.map((cell, ci) => (
              <td key={`${keyPrefix}-c-${ci}`} className="border border-slate-300 px-2 py-1">
                {renderInlineSegments(cell, `${keyPrefix}-${ri}-${ci}`)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Render nội dung chứa LaTeX trộn với văn bản thường, kèm hỗ trợ bảng số liệu (Markdown
 * table hoặc LaTeX \begin{tabular} cũ — KaTeX không tự render được bảng, phải tự parse).
 * Quy ước công thức: bọc trong $...$. Marker [CT?N] (công thức MathType cũ chưa OCR được)
 * hiển thị thành 1 thẻ cảnh báo nhỏ gọn — xem src/lib/extraction/docxExtract.ts.
 */
export function LatexText({ text: rawText }: { text: string }) {
  // Dữ liệu cũ (trước khi normalize.ts xử lý ở bước trích xuất) có thể còn literal "\n"
  // (2 ký tự backslash+n) thay vì ký tự xuống dòng thật — xử lý luôn ở đây để không cần
  // giáo viên upload lại file cũ.
  // CHỈ loại trừ 2 lệnh LaTeX thực sự bắt đầu bằng "n" hay gặp trong đề Toán (\neq, \nabla)
  // — dùng (?![a-zA-Z]) chung chung từng gây bug thật: câu văn tiếng Việt luôn viết hoa chữ
  // cái đầu câu, nên "\n" + chữ cái (vd "\nTứ phân vị...") là xuống dòng thật, không phải
  // lệnh LaTeX — chặn nhầm cả những câu đó thì literal "\n" lại hiện ra y như cũ.
  const text = rawText.replace(/\\n(?!eq|abla)/g, "\n");
  const tabularMatch = /\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/.exec(text);
  if (tabularMatch) {
    const rows = parseLatexTabular(tabularMatch[1]);
    const before = text.slice(0, tabularMatch.index);
    const after = text.slice(tabularMatch.index + tabularMatch[0].length);
    return (
      <>
        {before && <LatexText text={before} />}
        {rows && <Table rows={rows} keyPrefix="tabular" />}
        {after && <LatexText text={after} />}
      </>
    );
  }

  const lines = text.split("\n");
  const hasTableLine = lines.some((l) => l.trim().startsWith("|"));
  if (hasTableLine) {
    const nodes: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const table = parseMarkdownTable(lines, i);
      if (table) {
        nodes.push(<Table key={`tbl-${i}`} rows={table.rows} keyPrefix={`tbl-${i}`} />);
        i = table.next;
      } else {
        nodes.push(<span key={`ln-${i}`}>{renderInlineSegments(lines[i], `ln-${i}`)} </span>);
        i++;
      }
    }
    return <>{nodes}</>;
  }

  return <>{renderInlineSegments(text, "root")}</>;
}
