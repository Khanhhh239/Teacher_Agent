/**
 * Số hóa đề PDF theo TỪNG CÂU (thay cho đọc cả trang một lần):
 *   1. Phân đoạn bằng lớp chữ PDF (textLayerSegment) — toạ độ chính xác, không tốn token.
 *   2. Cắt từng câu từ ảnh render sạch; câu lem trang thì ghép dọc các mảnh thành 1 ảnh.
 *   3. Đọc MỖI câu 2 lần độc lập bằng 2 model khác nhau (song song).
 *   4. Kiểm chứng bằng code (KaTeX, cấu trúc) + so khớp 2 lần đọc → gắn cờ cụ thể.
 *   5. Câu nào không đọc được vẫn được tạo (kèm ảnh gốc, cờ chặn) — không bao giờ có "lỗ hổng".
 *
 * Lý do đọc từng câu (ĐÃ ĐO): đọc cả trang làm mất ký hiệu nhỏ như |f(x)| (8/8 lần), cắt riêng
 * từng câu thì giữ đúng (4/4 lần) vì ngân sách chi tiết ảnh dồn hết cho 1 câu.
 */
import type { ExtractionMeta } from "@/types/exam";
import { callGeminiWithImage, extractJson, MARKER_CHAR, stripMarkers } from "./llmClient";
import { waitForSlot } from "./rateLimiter";
import { segmentFromLines, type PageLines, type QuestionBlock } from "./textLayerSegment";
import {
  checkAgainstLayer,
  describeLayerCheck,
  diffReads,
  mathProblems,
  normalizeReadResult,
  structureProblems,
  type ReadQuestion,
} from "./questionChecks";

export const MODEL_A = "gemini-3.5-flash-lite";
export const MODEL_B = "gemini-3.1-flash-lite";
const RENDER_DPI = 250;

const QUESTION_PROMPT = `Bạn là trợ lý số hóa đề thi tiếng Việt. Ảnh đính kèm là ĐÚNG MỘT câu hỏi (có thể gồm 2 nửa ghép dọc nếu câu bị cắt ngang trang). Trả về DUY NHẤT một JSON:
{
  "type": "multiple_choice" | "true_false_group" | "short_answer",
  "content_latex": "phần đề dẫn",
  "options": [{"key": "A", "text_latex": "..."}],
  "sub_statements": [{"key": "a", "text_latex": "..."}],
  "figure_boxes": [{"id": "fig1", "bbox_1000": [x0, y0, x1, y1]}],
  "raw_ocr_notes": null
}
Quy tắc:
- type: có 4 phương án A/B/C/D → "multiple_choice"; có 4 ý a)/b)/c)/d) Đúng-Sai → "true_false_group"; chỉ có ô/chỗ điền đáp án, không có phương án → "short_answer".
- content_latex chỉ chứa phần đề dẫn. KHÔNG chép nhãn "Câu N." ở đầu câu. KHÔNG chép tiêu đề "PHẦN ...". KHÔNG chép lại các phương án A-D hay ý a-d vào content_latex (chúng chỉ nằm trong "options"/"sub_statements").
- CHÉP ĐÚNG TỪNG KÝ HIỆU nhìn thấy, tuyệt đối KHÔNG tự rút gọn hay "sửa cho hợp lý" công thức. Giữ nguyên dấu giá trị tuyệt đối |...| (viết \\left|...\\right|), dấu ngoặc, số mũ, chỉ số, dấu ≥ ≤, véc-tơ (viết \\overrightarrow{AB}). Phương án nào trông thừa hoặc sai vẫn phải chép đúng như in trong ảnh.
- Công thức toán bọc trong $...$. Bảng số liệu thông thường (tần số, dữ liệu...) dùng bảng Markdown: "| A | B |\\n| --- | --- |\\n| 1 | 2 |", KHÔNG dùng \\begin{tabular}.
- BẢNG BIẾN THIÊN (có mũi tên tăng/giảm), ĐỒ THỊ, hình học, sơ đồ là HÌNH: KHÔNG chép thành chữ, chỉ đưa vào "figure_boxes".
- figure_boxes: toạ độ theo ĐÚNG ẢNH NÀY, gốc ở góc trên-trái, thang 0-1000 cho cả hai trục, dạng [x0, y0, x1, y1]; nới rộng nhẹ ra mọi phía để không cắt mất nét vẽ hay nhãn. Không có hình thì để [].
- Điều kiện liệt kê bằng gạch đầu dòng "+", "-", "•": chèn ký tự xuống dòng "\\n" trước mỗi gạch đầu dòng.
- raw_ocr_notes: ghi ngắn gọn nếu có chỗ KHÔNG chắc chắn (chữ mờ, ký hiệu khó đọc); không thì null.
Chỉ trả JSON hợp lệ, không markdown, không code fence.`;

const MARKER_RULE_Q = `
QUY TẮC BẮT BUỘC về định dạng văn bản: trong MỌI trường chữ (content_latex, text_latex), cứ sau mỗi khoảng 3 từ liên tiếp phải chèn thêm đúng 1 ký hiệu " ${MARKER_CHAR} " (dấu gạch đứt U+00A6, có khoảng trắng 2 bên) tại chỗ ĐÃ có khoảng trắng. KHÔNG chèn vào giữa 1 lệnh LaTeX, giữa các chữ số của 1 số, hay bên trong cặp ngoặc {}. Hệ thống sẽ tự xóa ký hiệu này sau nên bắt buộc làm đúng. Cấu trúc JSON giữ NGUYÊN như yêu cầu ở trên (1 object, không bọc trong mảng).`;

/** Đọc lớp chữ của PDF: toàn bộ dòng chữ + bbox (đơn vị pt) của từng trang. */
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

interface ReadOutcome {
  read: ReadQuestion | null;
  /** true nếu phải dùng chế độ chống RECITATION mới đọc được */
  markerMode: boolean;
  note: string | null;
}

/** Đọc 1 ảnh câu bằng 1 model: đọc thường → nếu bị RECITATION thì đọc ở chế độ chèn ký hiệu. */
async function readOne(model: string, imageB64: string, deadline: number, warnings: string[]): Promise<ReadOutcome> {
  let recitation = false;
  for (const markerMode of [false, true]) {
    if (markerMode && !recitation) break;
    if (!(await waitForSlot(model, deadline))) return { read: null, markerMode, note: "hết thời gian xử lý" };
    try {
      const prompt = QUESTION_PROMPT + (markerMode ? MARKER_RULE_Q : "");
      const text = await callGeminiWithImage(imageB64, prompt, "image/png", warnings, 0, model);
      let read = normalizeReadResult(extractJson(text));
      if (markerMode) read = stripMarkers(read);
      return { read, markerMode, note: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RECITATION") && !markerMode) {
        recitation = true;
        continue;
      }
      return { read: null, markerMode, note: msg.slice(0, 120) };
    }
  }
  return { read: null, markerMode: true, note: "bị chặn bản quyền (RECITATION)" };
}

export interface PipelineResult {
  extracted: { title: string; subject: string; questions: Array<Record<string, unknown>> };
  images: Map<string, Buffer>;
  /** Ảnh crop gốc của từng câu, theo chỉ số câu (0-based). */
  crops: Map<number, Buffer>;
  metas: ExtractionMeta[];
  stats: { blocks: number; flagged: number; unread: number; disagreements: number; elapsedMs: number };
}

/**
 * Trả null nếu PDF không phân đoạn được bằng lớp chữ (bản quét, số câu không liên tục...) —
 * khi đó bên gọi dùng cách đọc cả trang cũ.
 */
export async function runQuestionPipeline(
  pdf: Buffer,
  warnings: string[],
  opts: { deadline: number; log?: (m: string) => void }
): Promise<PipelineResult | null> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});

  let seg;
  let pageLines: PageLines[] = [];
  try {
    pageLines = await extractPageLines(pdf);
    seg = segmentFromLines(pageLines);
  } catch (e) {
    log(`text layer failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!seg.ok) {
    log(`segmentation not possible: ${seg.reason}`);
    return null;
  }

  const sharp = (await import("sharp")).default;
  const { renderPdfPages } = await import("./pdfRender");
  const pagePngs = renderPdfPages(pdf, RENDER_DPI);
  const scale = RENDER_DPI / 72;

  const cropBlock = async (block: QuestionBlock): Promise<Buffer> => {
    const parts: Buffer[] = [];
    for (const s of block.segments) {
      const png = pagePngs[s.page];
      if (!png) continue;
      const meta = await sharp(png).metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      const top = Math.max(0, Math.min(H - 1, Math.round(s.y0 * scale)));
      const height = Math.max(8, Math.min(H - top, Math.round((s.y1 - s.y0) * scale)));
      parts.push(await sharp(png).extract({ left: 0, top, width: W, height }).png().toBuffer());
    }
    if (parts.length === 1) return parts[0];
    // Câu lem trang: ghép dọc các mảnh thành 1 ảnh để AI đọc như 1 câu liền mạch.
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

  const crops: Buffer[] = [];
  for (const b of seg.blocks) crops.push(await cropBlock(b));
  log(`segmented ${seg.blocks.length} questions, cropped in ${Date.now() - t0}ms`);

  const images = new Map<string, Buffer>();
  const cropMap = new Map<number, Buffer>();
  const metas: ExtractionMeta[] = [];
  const questions: Array<Record<string, unknown>> = new Array(seg.blocks.length);
  let unread = 0;
  let disagreements = 0;

  /** Chữ của lớp chữ PDF nằm trong vùng các đoạn của câu (dùng làm trọng tài độc lập). */
  const layerTextOf = (block: QuestionBlock): string =>
    block.segments
      .flatMap((sg) =>
        (pageLines[sg.page]?.lines ?? [])
          .filter((l) => (l.y0 + l.y1) / 2 >= sg.y0 && (l.y0 + l.y1) / 2 <= sg.y1)
          .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
          .map((l) => l.text)
      )
      .join(" ");

  const processBlock = async (block: QuestionBlock, idx: number) => {
    const crop = crops[idx];
    cropMap.set(idx, crop);
    const cropMeta = await sharp(crop).metadata();
    const b64 = crop.toString("base64");
    // Lần đọc B dùng ảnh phóng 1.5x để lỗi của 2 lần đọc ít tương quan hơn.
    const upscaled = await sharp(crop)
      .resize({ width: Math.round((cropMeta.width ?? 1000) * 1.5), kernel: "lanczos3" })
      .png()
      .toBuffer();

    const [A, B] = await Promise.all([
      readOne(MODEL_A, b64, opts.deadline, warnings),
      readOne(MODEL_B, upscaled.toString("base64"), opts.deadline, warnings),
    ]);

    const flags: string[] = [];
    const layerText = layerTextOf(block);
    const candidates = [A, B].filter((r): r is ReadOutcome & { read: ReadQuestion } => r.read !== null);
    const problemsOf = (r: ReadQuestion) => [...structureProblems(r), ...mathProblems(r)];

    let chosen: ReadQuestion | null = null;
    let alt: ReadQuestion | null = null;
    let disagreed = false;
    if (candidates.length === 2) {
      const diff = diffReads(A.read!, B.read!);
      const pa = problemsOf(A.read!);
      const pb = problemsOf(B.read!);
      // Hai bản khác nhau → trọng tài đầu tiên là LỚP CHỮ của PDF (bản nào khớp chữ/số của đề gốc
      // hơn), rồi tới số lỗi cấu trúc/cú pháp, hòa thì lấy lần đọc A.
      const la = checkAgainstLayer(A.read!, layerText).score;
      const lb = checkAgainstLayer(B.read!, layerText).score;
      chosen = lb < la ? B.read! : la < lb ? A.read! : pb.length < pa.length ? B.read! : A.read!;
      alt = chosen === A.read ? B.read! : A.read!;
      if (diff.length > 0) {
        disagreed = true;
        disagreements++;
        flags.push("Hai lần đọc (2 model) KHÁC NHAU — so với ảnh gốc để chọn bản đúng:");
        flags.push(...diff.slice(0, 4));
      } else {
        alt = null;
      }
    } else if (candidates.length === 1) {
      chosen = candidates[0].read;
      flags.push(`Chỉ có 1 trong 2 lần đọc thành công (${(A.read ? B : A).note ?? "lần còn lại lỗi"}) — chưa được kiểm chứng chéo`);
    }

    const markerUsed = candidates.some((c) => c.markerMode);
    if (markerUsed) {
      flags.push("Gemini chặn vì nghi trùng bản quyền (đề công khai) — đã đọc bằng chế độ chống trùng khớp, rà soát kỹ câu này");
    }

    // Câu không đọc được: vẫn tạo, kèm ảnh gốc, chặn xác nhận cho tới khi giáo viên xử lý.
    if (!chosen) {
      unread++;
      const srcName = `q${block.number}_src.png`;
      images.set(srcName, crop);
      metas[idx] = {
        flags: [`CHƯA ĐỌC ĐƯỢC TỰ ĐỘNG (${A.note ?? B.note ?? "lỗi"}) — xem ảnh gốc và nhập lại nội dung câu này`],
        blocking: true,
        reads: 0,
        source: "text_layer",
      };
      questions[idx] = {
        type: "short_answer",
        content_latex: "(Chưa đọc được tự động — xem ảnh gốc bên dưới rồi nhập lại nội dung câu hỏi này)",
        part_label: block.part,
        image_urls: [srcName],
        options: [],
        sub_statements: [],
        correct_answer: null,
        short_answer_normalized: null,
        score_rule: "standard",
        max_score: 0.5,
        raw_ocr_notes: null,
      };
      return;
    }

    flags.push(...problemsOf(chosen));
    // Đối chiếu bản được chọn với lớp chữ gốc (bắt cả lỗi mà cả 2 lần đọc cùng mắc).
    flags.push(...describeLayerCheck(checkAgainstLayer(chosen, layerText), candidates.length < 2 || disagreed));

    // Hai lần đọc bất đồng về số hình: lấy khung hình của lần đọc thấy NHIỀU hình hơn (thiếu hình
    // nghiêm trọng hơn dư hình — dư thì giáo viên xóa, thiếu thì học sinh không đủ dữ kiện làm bài).
    const figureSource =
      candidates.length === 2 && alt && alt.figure_boxes.length > chosen.figure_boxes.length ? alt : chosen;

    // Cắt hình minh họa từ chính ảnh crop của câu → hình luôn thuộc đúng câu này.
    const imageNames: string[] = [];
    const cm = await sharp(crop).metadata();
    const W = cm.width ?? 0;
    const H = cm.height ?? 0;
    let k = 0;
    for (const fb of figureSource.figure_boxes) {
      const [rx0, ry0, rx1, ry1] = fb.bbox;
      const m = 0.03;
      const x0 = Math.max(0, rx0 - (rx1 - rx0) * m);
      const y0 = Math.max(0, ry0 - (ry1 - ry0) * m);
      const x1 = Math.min(1000, rx1 + (rx1 - rx0) * m);
      const y1 = Math.min(1000, ry1 + (ry1 - ry0) * m);
      const left = Math.round((x0 / 1000) * W);
      const top = Math.round((y0 / 1000) * H);
      const width = Math.min(W - left, Math.round(((x1 - x0) / 1000) * W));
      const height = Math.min(H - top, Math.round(((y1 - y0) / 1000) * H));
      if (width < 24 || height < 24) continue;
      k++;
      const name = `q${block.number}_fig${k}.png`;
      images.set(name, await sharp(crop).extract({ left, top, width, height }).png().toBuffer());
      imageNames.push(name);
    }

    metas[idx] = {
      flags,
      reads: candidates.length,
      source: "text_layer",
      alt: alt ? { content_latex: alt.content_latex, options: alt.options.map((o) => ({ ...o })), sub_statements: alt.sub_statements } : null,
    };
    questions[idx] = {
      type: chosen.type,
      content_latex: chosen.content_latex,
      part_label: block.part,
      image_urls: imageNames,
      options: chosen.options,
      sub_statements: chosen.sub_statements.map((s) => ({ ...s, answer: false })),
      correct_answer: null,
      short_answer_normalized: null,
      score_rule: chosen.type === "true_false_group" ? "thpt2025_truefalse_partial" : "standard",
      max_score: chosen.type === "multiple_choice" ? 0.25 : chosen.type === "true_false_group" ? 1.0 : 0.5,
      raw_ocr_notes: chosen.raw_ocr_notes,
    };
  };

  await Promise.all(seg.blocks.map((b, i) => processBlock(b, i)));

  const flagged = metas.filter((m) => m.flags.length > 0).length;
  const stats = { blocks: seg.blocks.length, flagged, unread, disagreements, elapsedMs: Date.now() - t0 };
  warnings.push(
    `Đọc theo từng câu (phân đoạn bằng lớp chữ PDF): ${stats.blocks} câu, ${stats.flagged} câu có cờ cảnh báo, ${unread} câu chưa đọc được tự động, ${disagreements} câu hai lần đọc khác nhau.`
  );
  return { extracted: { title: seg.title, subject: "", questions }, images, crops: cropMap, metas, stats };
}
