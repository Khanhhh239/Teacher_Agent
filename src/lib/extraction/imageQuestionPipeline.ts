/**
 * Số hóa đề PDF bằng CÁCH DÙNG ẢNH GỐC làm nội dung câu hỏi — thay cho việc bắt AI chép lại
 * công thức thành LaTeX (nguồn gốc mọi lỗi mất ký hiệu đã gặp: dấu |, số, dấu véc-tơ...).
 *
 * Luồng, KHÔNG gọi AI lần nào cho nội dung đề:
 *   1. Phân đoạn bằng lớp chữ PDF (textLayerSegment) — tìm "Câu N"/"PHẦN" bằng code.
 *   2. Render từng trang ra ảnh sạch.
 *   3. XÓA đúng nhãn "Câu N." khỏi ảnh (toạ độ TỪNG KÝ TỰ lấy từ PDF, đã kiểm chứng thực tế:
 *      tô trắng chính xác vùng nhãn, không đụng tới chữ sau nó) — vì số thứ tự hiển thị cho
 *      học sinh là số VỊ TRÍ sau khi xáo trộn (web tự in ra ngoài ảnh), không phải số gốc in
 *      sẵn trong PDF.
 *   4. Cắt ảnh theo từng câu; câu lem 2 trang thì cắt riêng từng mảnh rồi GHÉP DỌC thành 1 ảnh.
 *
 * Loại câu (trắc nghiệm/đúng-sai/điền ngắn) và đáp án đúng lấy HOÀN TOÀN từ file đáp án
 * (xem buildQuestionsFromAnswerKey) — không cần AI "đọc hiểu" nội dung đề chút nào, nên không
 * còn RECITATION, không còn lỗi chép sai ký hiệu, không tốn token cho phần này.
 */
import type { AnswerKeyEntry } from "./llmClient";
import { segmentFromLines, type PageLines, type QuestionBlock, type TextLine } from "./textLayerSegment";

export const RENDER_DPI = 300;

export interface PageChar {
  c: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Đọc lớp chữ của PDF: toàn bộ dòng chữ + bbox (đơn vị pt) của từng trang — dùng để phân đoạn. */
export async function extractPageLines(pdf: Buffer): Promise<PageLines[]> {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const pages: PageLines[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [bx0, by0, bx1, by1] = page.getBounds();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON()) as any;
    const lines: PageLines["lines"] = [];
    for (const block of json.blocks ?? []) {
      if (block.type === "image") continue;
      for (const line of block.lines ?? []) {
        const b = line.bbox;
        lines.push({ text: String(line.text ?? ""), x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
      }
    }
    pages.push({ width: bx1 - bx0, height: by1 - by0, lines });
  }
  return pages;
}

/** Đọc toạ độ TỪNG KÝ TỰ của mỗi trang (đã kiểm chứng thực tế qua mupdf's walk API) — chỉ dùng
 * để tính điểm cắt chính xác khi xóa nhãn "Câu N.", không dùng cho việc gì khác. */
export async function extractPageChars(pdf: Buffer): Promise<PageChar[][]> {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const pages: PageChar[][] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const st = page.toStructuredText("preserve-whitespace");
    const chars: PageChar[] = [];
    st.walk({
      onChar(c: string, _origin: unknown, _font: unknown, _size: unknown, quad: number[]) {
        chars.push({ c, x0: quad[0], y0: quad[1], x1: quad[2], y1: quad[5] });
      },
    });
    pages.push(chars);
  }
  return pages;
}

/** Tìm điểm cắt theo trục X (đơn vị pt, trang gốc) ngay sau nhãn "Câu N." của 1 dòng, dùng
 * toạ độ từng ký tự khớp đúng vị trí dòng đó. Trả về null nếu không đủ dữ liệu ký tự (hiếm —
 * khi đó bỏ qua, không xóa gì, nhãn gốc vẫn còn trong ảnh thay vì có nguy cơ cắt nhầm chữ). */
export function findLabelCutoffX(pageChars: PageChar[], line: TextLine, labelLength: number): number | null {
  if (labelLength <= 0) return null;
  const midY = (line.y0 + line.y1) / 2;
  const lineChars = pageChars
    .filter((ch) => ch.y0 <= midY && ch.y1 >= midY && ch.x0 >= line.x0 - 2 && ch.x0 <= line.x1 + 2)
    .sort((a, b) => a.x0 - b.x0);
  if (lineChars.length < labelLength) return null;
  return lineChars[labelLength - 1].x1 + 1; // +1pt đệm an toàn
}

export interface ImageQuestion {
  number: number;
  part: string | null;
  /** Ảnh crop cuối cùng của câu (đã xóa nhãn "Câu N.", đã ghép nếu lem trang). */
  image: Buffer;
}

/**
 * Phân đoạn + render + xóa nhãn + cắt/ghép — hoàn toàn bằng code, không gọi AI. Trả về null
 * nếu KHÔNG phân đoạn được (PDF không có lớp chữ — bản quét/ảnh, hoặc đánh số không liên tục).
 */
export async function buildImageQuestions(
  pdf: Buffer
): Promise<{ ok: true; title: string; questions: ImageQuestion[] } | { ok: false; reason: string }> {
  const pageLines = await extractPageLines(pdf);
  const seg = segmentFromLines(pageLines);
  if (!seg.ok) return { ok: false, reason: seg.reason };

  const sharp = (await import("sharp")).default;
  const { renderPdfPages } = await import("./pdfRender");
  const pageChars = await extractPageChars(pdf);
  const rawPagePngs = renderPdfPages(pdf, RENDER_DPI);
  const scale = RENDER_DPI / 72;

  // Xóa TẤT CẢ nhãn "Câu N." trên mỗi trang trong 1 lượt composite (rẻ hơn nhiều lần composite
  // riêng lẻ) — ảnh kết quả mới là ảnh dùng để cắt câu, ảnh gốc rawPagePngs không bị đụng tới.
  const cleanPagePngs: Buffer[] = [];
  for (let p = 0; p < rawPagePngs.length; p++) {
    const blocksOnPage = seg.blocks.filter((b) => b.labelLine && pageOf(b) === p);
    if (blocksOnPage.length === 0) {
      cleanPagePngs.push(rawPagePngs[p]);
      continue;
    }
    const rects = blocksOnPage
      .map((b) => {
        const cutX = findLabelCutoffX(pageChars[p] ?? [], b.labelLine, b.labelLength);
        if (cutX === null) return null;
        const top = Math.max(0, Math.round(b.labelLine.y0 * scale) - 2);
        const height = Math.round((b.labelLine.y1 - b.labelLine.y0) * scale) + 4;
        const width = Math.round(cutX * scale);
        return `<rect x="0" y="${top}" width="${width}" height="${height}" fill="white"/>`;
      })
      .filter((x): x is string => x !== null);
    if (rects.length === 0) {
      cleanPagePngs.push(rawPagePngs[p]);
      continue;
    }
    const meta = await sharp(rawPagePngs[p]).metadata();
    const patched = await sharp(rawPagePngs[p])
      .composite([{ input: Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${rects.join("")}</svg>`), left: 0, top: 0 }])
      .png()
      .toBuffer();
    cleanPagePngs.push(patched);
  }

  function pageOf(b: QuestionBlock): number {
    return b.segments[0]?.page ?? -1;
  }

  const cropBlock = async (block: QuestionBlock): Promise<Buffer> => {
    const parts: Buffer[] = [];
    for (const s of block.segments) {
      const png = cleanPagePngs[s.page];
      if (!png) continue;
      const meta = await sharp(png).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      const top = Math.max(0, Math.min(H - 1, Math.round(s.y0 * scale)));
      const height = Math.max(8, Math.min(H - top, Math.round((s.y1 - s.y0) * scale)));
      parts.push(await sharp(png).extract({ left: 0, top, width: W, height }).png().toBuffer());
    }
    if (parts.length === 1) return parts[0];
    // Câu lem trang: ghép dọc các mảnh thành 1 ảnh duy nhất (nền trắng, cách nhau 1 khoảng nhỏ).
    const metas = await Promise.all(parts.map((p) => sharp(p).metadata()));
    const GAP = 16;
    const width = Math.max(...metas.map((m) => m.width ?? 0));
    const totalH = metas.reduce((n, m) => n + (m.height ?? 0), 0) + GAP * (parts.length - 1);
    let y = 0;
    const composites = parts.map((input, i) => {
      const item = { input, left: 0, top: y };
      y += (metas[i].height ?? 0) + GAP;
      return item;
    });
    return sharp({ create: { width, height: totalH, channels: 3, background: "#ffffff" } }).composite(composites).png().toBuffer();
  };

  const questions: ImageQuestion[] = [];
  for (const block of seg.blocks) {
    questions.push({ number: block.number, part: block.part, image: await cropBlock(block) });
  }
  return { ok: true, title: seg.title, questions };
}

type KeyKind = "multiple_choice" | "true_false_group" | "short_answer";

function keyKind(e: AnswerKeyEntry): KeyKind | null {
  if (e.sub_statements?.length) return "true_false_group";
  if (e.correct_answer) return "multiple_choice";
  if (e.value) return "short_answer";
  return null;
}

export interface BuiltQuestionRow {
  type: KeyKind;
  part_label: string | null;
  options: { key: string; text_latex: string }[];
  sub_statements: { key: string; text_latex: string; answer: boolean }[];
  correct_answer: string | null;
  short_answer_normalized: string | null;
  score_rule: "standard" | "thpt2025_truefalse_partial";
  max_score: number;
  flags: string[];
  blocking: boolean;
}

const MC_KEYS = ["A", "B", "C", "D"];
const TF_KEYS = ["a", "b", "c", "d"];

/**
 * Ghép từng câu (theo vị trí trong đề, 1-based) với đáp án tương ứng trong file đáp án —
 * đây là nơi DUY NHẤT quyết định loại câu (trắc nghiệm/đúng-sai/điền ngắn) và đáp án đúng,
 * hoàn toàn từ file đáp án, không cần AI đọc hiểu nội dung đề.
 */
export function buildQuestionsFromAnswerKey(questionCount: number, parts: (string | null)[], answerKey: AnswerKeyEntry[]): BuiltQuestionRow[] {
  const byNumber = new Map(answerKey.map((a) => [a.question_number, a]));
  const rows: BuiltQuestionRow[] = [];
  for (let i = 0; i < questionCount; i++) {
    const entry = byNumber.get(i + 1);
    const kind = entry ? keyKind(entry) : null;
    if (!entry || !kind) {
      rows.push({
        type: "multiple_choice",
        part_label: parts[i] ?? null,
        options: MC_KEYS.map((key) => ({ key, text_latex: "" })),
        sub_statements: [],
        correct_answer: null,
        short_answer_normalized: null,
        score_rule: "standard",
        max_score: 0.25,
        flags: [`Chưa có đáp án cho câu ${i + 1} trong file đáp án — giáo viên tự chọn loại câu và đáp án đúng.`],
        blocking: true,
      });
      continue;
    }
    if (kind === "multiple_choice") {
      rows.push({
        type: kind,
        part_label: parts[i] ?? null,
        options: MC_KEYS.map((key) => ({ key, text_latex: "" })),
        sub_statements: [],
        correct_answer: String(entry.correct_answer).trim().toUpperCase(),
        short_answer_normalized: null,
        score_rule: "standard",
        max_score: 0.25,
        flags: [],
        blocking: false,
      });
    } else if (kind === "true_false_group") {
      const answerByKey = new Map((entry.sub_statements ?? []).map((s) => [s.key, s.answer]));
      const flags: string[] = [];
      if (answerByKey.size < 4) flags.push(`Câu ${i + 1}: file đáp án chỉ có ${answerByKey.size}/4 ý đúng/sai.`);
      rows.push({
        type: kind,
        part_label: parts[i] ?? null,
        options: [],
        sub_statements: TF_KEYS.map((key) => ({ key, text_latex: "", answer: answerByKey.get(key) ?? false })),
        correct_answer: null,
        short_answer_normalized: null,
        score_rule: "thpt2025_truefalse_partial",
        max_score: 1.0,
        flags,
        blocking: false,
      });
    } else {
      rows.push({
        type: kind,
        part_label: parts[i] ?? null,
        options: [],
        sub_statements: [],
        correct_answer: null,
        short_answer_normalized: String(entry.value).trim(),
        score_rule: "standard",
        max_score: 0.5,
        flags: [],
        blocking: false,
      });
    }
  }
  const keyCount = new Set(answerKey.map((a) => a.question_number)).size;
  if (keyCount > 0 && keyCount !== questionCount) {
    for (const r of rows) {
      r.flags.push(`Đề có ${questionCount} câu nhưng file đáp án có ${keyCount} câu — kiểm tra xem có câu nào bị sót/gộp không.`);
      break;
    }
  }
  return rows;
}
