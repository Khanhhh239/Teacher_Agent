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
import { segmentFromLines, type QuestionBlock, type TextLine } from "./textLayerSegment";
import { extractPageLines } from "./pdfTextLayer";
import { removeRepeatedBanners, renderPdfPages } from "./pdfRender";

export { extractPageLines };

export const RENDER_DPI = 300;

export interface PageChar {
  c: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  const labelEnd = lineChars[labelLength - 1].x1;
  const proposed = labelEnd + 1; // +1pt đệm cơ bản
  const nextChar = lineChars[labelLength]; // ký tự chữ cái đầu tiên của câu, ngay sau nhãn (nếu cùng dòng)
  if (!nextChar) return proposed;
  // Tuyệt đối không để điểm cắt chạm/vượt mép trái của chữ cái đầu câu — nếu nhãn và chữ đầu
  // quá sát nhau, thà tẩy thiếu một chút viền nhãn còn hơn ăn mất chữ thật (đã gặp thực tế: mất
  // hẳn chữ "T" đầu câu "Trong..." khi khoảng cách này quá hẹp).
  const SAFETY_PT = 1.2;
  return Math.max(labelEnd, Math.min(proposed, nextChar.x0 - SAFETY_PT));
}

export interface ImageQuestion {
  number: number;
  part: string | null;
  /** Ảnh crop cuối cùng của câu (đã xóa nhãn "Câu N.", đã ghép nếu lem trang). */
  image: Buffer;
}

/**
 * Phân đoạn + render + xóa nhãn + cắt/ghép. Nhánh chính (phân đoạn bằng lớp chữ PDF) không gọi
 * AI lần nào. Khi PDF không có lớp chữ thật (vd file chính thức ghép từ nhiều dải ảnh — xem
 * visionSegment.ts), tự động chuyển sang nhánh dự phòng: AI CHỈ định vị toạ độ nhãn "Câu N",
 * không đọc/chép nội dung — ảnh câu hỏi hiển thị cho học sinh vẫn luôn là ảnh gốc 100%.
 */
export async function buildImageQuestions(
  pdf: Buffer,
  opts: { warnings?: string[]; deadline?: number } = {}
): Promise<{ ok: true; title: string; questions: ImageQuestion[]; usedVision: boolean } | { ok: false; reason: string }> {
  const pageLines = await extractPageLines(pdf);
  const rawPagePngs = await removeRepeatedBanners(renderPdfPages(pdf, RENDER_DPI));

  let seg = segmentFromLines(pageLines);
  let usedVision = false;
  if (!seg.ok && seg.reason.includes("không có lớp chữ")) {
    const { segmentFromVisionLabels } = await import("./visionSegment");
    const pageSizes = pageLines.map((p) => ({ width: p.width, height: p.height }));
    const visionSeg = await segmentFromVisionLabels(rawPagePngs, pageSizes, opts.warnings, opts.deadline);
    if (!visionSeg.ok) {
      return { ok: false, reason: `${seg.reason}. Đã thử định vị bằng AI thị giác (không đọc nội dung) nhưng cũng thất bại: ${visionSeg.reason}` };
    }
    seg = visionSeg;
    usedVision = true;
  }
  if (!seg.ok) return { ok: false, reason: seg.reason };

  const sharp = (await import("sharp")).default;
  // Toạ độ từng ký tự chỉ có ý nghĩa ở nhánh lớp chữ thật. Nhánh AI thị giác không được phép
  // dùng nguyên x1 của bbox để tẩy từ mép trái: model đôi khi khoanh rộng sang chữ đầu câu.
  const pageChars = usedVision ? [] : await extractPageChars(pdf);
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
        const cutX = findLabelCutoffX(pageChars[p] ?? [], b.labelLine, b.labelLength) ?? b.labelBoxX1 ?? null;
        if (cutX === null) return null;
        const top = Math.max(0, Math.round(b.labelLine.y0 * scale) - 2);
        const height = Math.round((b.labelLine.y1 - b.labelLine.y0) * scale) + 4;
        if (!usedVision) {
          const width = Math.round(cutX * scale);
          return `<rect x="0" y="${top}" width="${width}" height="${height}" fill="white"/>`;
        }
        // Nhánh ảnh dùng bbox đo trên lưới 20/1000. Không dùng vùng cố định rộng (trước đây
        // là 52pt), vì vùng đó đã ăn mất chữ đầu câu trong de1. Chỉ chừa đệm 0.8pt quanh
        // đúng bbox nhãn; lùi mép phải thêm 3pt để không ăn vào ký tự đầu câu khi model
        // khoanh hơi rộng (đã quan sát de1: mất "T" của Trong và "C" của Cho).
        const labelX0 = Math.max(0, b.labelLine.x0);
        const labelX1 = Math.min(Math.max(cutX - 3, labelX0 + 10), labelX0 + 44);
        const left = Math.max(0, Math.round((labelX0 - 0.8) * scale));
        const right = Math.round((labelX1 + 0.8) * scale);
        return `<rect x="${left}" y="${top}" width="${Math.max(1, right - left)}" height="${height}" fill="white"/>`;
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

  // Nới thêm tối đa ~2.5mm phía trên mỗi mảnh cắt để không hụt mất phần trên của chữ/công thức
  // (vd "ax+b" của Câu 5) khi ranh giới câu nằm sát đỉnh dòng chữ — NHƯNG chỉ nới vào khoảng
  // trắng THẬT SỰ còn trống phía trên (đo bằng lớp chữ), không bao giờ lấn vào dòng cuối của
  // câu TRƯỚC (đã gặp thực tế: dính cả đáp án câu trước vào đầu ảnh câu sau khi 2 câu nằm sát
  // nhau). Nhánh AI thị giác (PDF không có lớp chữ) không có dữ liệu để đo an toàn nên bỏ qua.
  const TOP_PAD_PT = (2.5 / 25.4) * 72;
  const TOP_SAFETY_PT = 1.5;

  function maxSafeTopPadPt(page: number, y0: number): number {
    if (usedVision) return 0;
    const lines = pageLines[page]?.lines ?? [];
    let nearestAboveY1 = -Infinity;
    for (const l of lines) {
      // Xét MỌI dòng BẮT ĐẦU trước ranh giới (kể cả khi đáy dòng đó vượt nhẹ qua y0 do PAD=2pt
      // của bước phân đoạn) — lọc theo "y1 <= y0" trước đây bỏ sót đúng trường hợp dòng cuối câu
      // trước nằm sát ranh giới trong khoảng <2pt, khiến thuật toán tưởng nhầm còn khoảng trống
      // lớn hơn ở dòng xa hơn phía trên, lố pad vào đè lên dòng đó (đã gặp thực tế: dính nguyên
      // dòng đáp án A/B/C/D của câu trước vào đầu ảnh câu sau).
      if (!l.text.trim() || l.y0 >= y0) continue;
      if (l.y1 > nearestAboveY1) nearestAboveY1 = l.y1;
    }
    if (nearestAboveY1 === -Infinity) return TOP_PAD_PT; // không có dòng nào phía trên — an toàn, nới hết mức
    return Math.max(0, y0 - nearestAboveY1 - TOP_SAFETY_PT);
  }

  const cropBlock = async (block: QuestionBlock): Promise<Buffer> => {
    const parts: Buffer[] = [];
    for (const s of block.segments) {
      const png = cleanPagePngs[s.page];
      if (!png) continue;
      const meta = await sharp(png).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      const naturalTop = Math.round(s.y0 * scale);
      const padPt = Math.min(TOP_PAD_PT, maxSafeTopPadPt(s.page, s.y0));
      const top = Math.max(0, Math.min(H - 1, naturalTop - Math.round(padPt * scale)));
      const height = Math.max(8, Math.min(H - top, Math.round((s.y1 - s.y0) * scale) + (naturalTop - top)));
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
  return { ok: true, title: seg.title, questions, usedVision };
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
