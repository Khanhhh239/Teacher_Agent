import katex from "katex";
import type { QuestionType } from "@/types/exam";

/** Kết quả 1 lần đọc 1 câu hỏi từ ảnh crop. */
export interface ReadQuestion {
  type: QuestionType;
  content_latex: string;
  options: { key: string; text_latex: string }[];
  sub_statements: { key: string; text_latex: string }[];
  /** Khung hình theo ảnh crop, thang 0-1000, dạng [x0, y0, x1, y1]. */
  figure_boxes: { id: string; bbox: [number, number, number, number] }[];
  raw_ocr_notes: string | null;
}

const TYPES: QuestionType[] = ["multiple_choice", "true_false_group", "short_answer"];

/** AI đôi khi trả mảng, hoặc {questions:[...]}, hoặc box_2d kiểu [ymin,xmin,ymax,xmax] — chuẩn hóa hết. */
export function normalizeReadResult(raw: unknown): ReadQuestion {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let o: any = raw;
  if (Array.isArray(o)) o = o[0];
  if (o && Array.isArray(o.questions)) o = o.questions[0];
  o = o ?? {};

  const options = (Array.isArray(o.options) ? o.options : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => ({ key: String(x?.key ?? "").trim().toUpperCase(), text_latex: String(x?.text_latex ?? x?.text ?? "") }))
    .filter((x: { key: string }) => x.key);
  const subs = (Array.isArray(o.sub_statements) ? o.sub_statements : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => ({ key: String(x?.key ?? "").trim().toLowerCase(), text_latex: String(x?.text_latex ?? x?.text ?? "") }))
    .filter((x: { key: string }) => x.key);

  const figure_boxes: ReadQuestion["figure_boxes"] = [];
  (Array.isArray(o.figure_boxes) ? o.figure_boxes : []).forEach((f: any, i: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let b: unknown = f?.bbox_1000 ?? f?.bbox;
    if (!b && Array.isArray(f?.box_2d) && f.box_2d.length === 4) {
      const [ymin, xmin, ymax, xmax] = f.box_2d; // định dạng gốc của Gemini
      b = [xmin, ymin, xmax, ymax];
    }
    if (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && Number.isFinite(n))) {
      const [x0, y0, x1, y1] = b as number[];
      if (x1 > x0 && y1 > y0) figure_boxes.push({ id: String(f?.id ?? `fig${i + 1}`), bbox: [x0, y0, x1, y1] });
    }
  });

  const type: QuestionType = TYPES.includes(o.type)
    ? o.type
    : options.length > 0
      ? "multiple_choice"
      : subs.length > 0
        ? "true_false_group"
        : "short_answer";

  return {
    type,
    // Prompt dặn không chép nhãn "Câu N." nhưng đôi khi model vẫn chép — bỏ ngay để không lọt vào nội dung.
    content_latex: String(o.content_latex ?? "").replace(/^\s*Câu\s*\d+\s*[.:]\s*/i, ""),
    options,
    sub_statements: subs,
    figure_boxes,
    raw_ocr_notes: typeof o.raw_ocr_notes === "string" && o.raw_ocr_notes.trim() ? o.raw_ocr_notes.trim() : null,
  };
}

/**
 * Chuẩn hóa chuỗi LaTeX để so 2 lần đọc: bỏ khác biệt vô hại (khoảng trắng, \left \right, \dfrac,
 * ^{2} so với ^2...) nhưng GIỮ các khác biệt có nghĩa (dấu |, chữ số, dấu, cấu trúc phân số...).
 * Cố ý KHÔNG bỏ dấu ngoặc nhọn chung chung vì \frac{a}{bc} và \frac{ab}{c} khác nghĩa.
 */
export function normForCompare(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\$/g, "") // ký hiệu bọc công thức $...$ không mang nghĩa nội dung ($5$ và 5 là một)
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\\vec\b/g, "\\overrightarrow")
    .replace(/\\(?:ldots|cdots|dots)\b/g, "...")
    .replace(/\\(?:left|right|displaystyle|textstyle|bigl|bigr|Bigl|Bigr)\b/g, "")
    .replace(/\\[,;:! ]/g, "")
    .replace(/\\(?:dfrac|tfrac)\b/g, "\\frac")
    .replace(/\\(?:mathrm|text|mathbf)\{([^{}]*)\}/g, "$1")
    .replace(/([\^_])\{(\w)\}/g, "$1$2")
    .replace(/\\(?:leqslant|le)\b/g, "\\leq")
    .replace(/\\(?:geqslant|ge)\b/g, "\\geq")
    .replace(/\\(?:vert|lvert|rvert)\b/g, "|")
    .replace(/\s+/g, "")
    .replace(/[.,;:]+$/, "");
}

function firstDiffSnippet(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s: string) => s.slice(Math.max(0, i - 12), i + 28);
  return `lần 1: …${cut(a)}… | lần 2: …${cut(b)}…`;
}

/** Danh sách mô tả chỗ khác nhau giữa 2 lần đọc (rỗng = khớp nhau sau chuẩn hóa). */
export function diffReads(a: ReadQuestion, b: ReadQuestion): string[] {
  const out: string[] = [];
  if (a.type !== b.type) out.push(`Hai lần đọc xếp loại câu khác nhau (${a.type} và ${b.type})`);
  const ca = normForCompare(a.content_latex);
  const cb = normForCompare(b.content_latex);
  if (ca !== cb) out.push(`Nội dung đề khác nhau giữa 2 lần đọc — ${firstDiffSnippet(ca, cb)}`);

  const compareList = (label: string, la: { key: string; text_latex: string }[], lb: { key: string; text_latex: string }[]) => {
    const mb = new Map(lb.map((x) => [x.key, x.text_latex]));
    for (const x of la) {
      if (!mb.has(x.key)) {
        out.push(`${label} ${x.key} chỉ xuất hiện ở 1 lần đọc`);
        continue;
      }
      const na = normForCompare(x.text_latex);
      const nb = normForCompare(mb.get(x.key)!);
      if (na !== nb) out.push(`${label} ${x.key} khác nhau — ${firstDiffSnippet(na, nb)}`);
    }
    for (const x of lb) if (!la.some((y) => y.key === x.key)) out.push(`${label} ${x.key} chỉ xuất hiện ở 1 lần đọc`);
  };
  compareList("Phương án", a.options, b.options);
  compareList("Ý", a.sub_statements, b.sub_statements);
  if (a.figure_boxes.length !== b.figure_boxes.length) {
    out.push(`Số hình phát hiện khác nhau (${a.figure_boxes.length} và ${b.figure_boxes.length})`);
  }
  return out;
}

function mathSegments(text: string): string[] {
  const segs: string[] = [];
  const re = /\$([^$]+)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) segs.push(m[1]);
  return segs;
}

/** Công thức không render được bằng KaTeX / dấu $ lẻ — những lỗi này học sinh sẽ thấy ngay. */
export function mathProblems(q: ReadQuestion): string[] {
  const out: string[] = [];
  const texts: [string, string][] = [
    ["nội dung", q.content_latex],
    ...q.options.map((o): [string, string] => [`phương án ${o.key}`, o.text_latex]),
    ...q.sub_statements.map((s): [string, string] => [`ý ${s.key}`, s.text_latex]),
  ];
  for (const [where, t] of texts) {
    if ((t.match(/\$/g) ?? []).length % 2 === 1) out.push(`Dấu $ lẻ trong ${where} (công thức có thể bị cắt)`);
    for (const seg of mathSegments(t)) {
      try {
        katex.renderToString(seg, { throwOnError: true, strict: "ignore", trust: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message.replace(/^KaTeX parse error:\s*/, "") : String(e);
        out.push(`Công thức lỗi cú pháp trong ${where}: ${msg.slice(0, 80)}`);
        break;
      }
    }
  }
  return out;
}

/** Kiểm tra cấu trúc bằng luật cứng (không cần AI). */
export function structureProblems(q: ReadQuestion, markerChar = "¦"): string[] {
  const out: string[] = [];
  const keysOf = (l: { key: string }[]) => l.map((x) => x.key).join("");
  if (!q.content_latex.trim()) out.push("Nội dung đề rỗng");
  if (q.type === "multiple_choice" && keysOf(q.options) !== "ABCD") {
    out.push(`Trắc nghiệm không đủ 4 phương án A–D (đọc được: ${keysOf(q.options) || "không có"})`);
  }
  if (q.type === "true_false_group" && keysOf(q.sub_statements) !== "abcd") {
    out.push(`Câu đúng/sai không đủ 4 ý a–d (đọc được: ${keysOf(q.sub_statements) || "không có"})`);
  }
  if (q.type === "short_answer" && (q.options.length > 0 || q.sub_statements.length > 0)) {
    out.push("Câu điền đáp án nhưng lại có phương án/ý");
  }
  for (const o of q.options) if (!o.text_latex.trim()) out.push(`Phương án ${o.key} rỗng`);
  for (const s of q.sub_statements) if (!s.text_latex.trim()) out.push(`Ý ${s.key} rỗng`);
  // Đề nhắc tới hình/đồ thị/bảng biến thiên mà không tách được hình nào → rất có thể bị mất hình.
  if (q.figure_boxes.length === 0 && /(hình\s*(vẽ|bên|dưới|sau)|như\s+hình|đồ\s*thị|bảng\s*biến\s*thiên)/i.test(q.content_latex)) {
    out.push("Đề nhắc tới hình/đồ thị/bảng biến thiên nhưng chưa tách được hình — kiểm tra ảnh gốc xem có thiếu hình không");
  }
  const all = JSON.stringify(q);
  if (all.includes(markerChar)) out.push("Còn sót ký hiệu phân tách ¦");
  if (/\[IMAGE:/.test(all)) out.push("Còn sót marker [IMAGE:...]");
  if (/PHẦN\s+[IVXLC\d]+\./.test(q.content_latex)) out.push("Nội dung còn lẫn tiêu đề PHẦN");
  return out;
}
