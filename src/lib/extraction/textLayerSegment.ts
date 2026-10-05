/**
 * Phân đoạn đề thi PDF thành từng câu hỏi bằng LỚP CHỮ của PDF (PDF xuất từ Word có sẵn lớp
 * chữ): tìm các dòng bắt đầu bằng "Câu N." và "PHẦN ..." rồi lấy toạ độ chính xác của chúng.
 * Không cần AI, không tốn token, không đoán toạ độ. Đã đo trên đề mẫu: tìm đủ 22/22 nhãn.
 *
 * Đây là phần thuần (không import mupdf) để test được bằng tsx; việc đọc lớp chữ từ PDF thật
 * nằm ở questionPipeline.ts.
 */

export interface TextLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ImageBlock {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

export interface PageLines {
  width: number;
  height: number;
  lines: TextLine[];
  /** Ảnh được nhúng trong trang PDF, dùng để tính đủ vùng crop của câu. */
  imageBlocks: ImageBlock[];
}

/** Đoạn dọc của 1 trang (đơn vị pt) thuộc về 1 câu hỏi. */
export interface Segment {
  page: number;
  y0: number;
  y1: number;
}

export interface QuestionBlock {
  number: number;
  part: string | null;
  segments: Segment[];
  /** Dòng chứa nhãn "Câu N." gốc — dùng để xóa đúng phần nhãn khỏi ảnh crop (số câu hiển thị
   * cho học sinh là số VỊ TRÍ sau khi xáo trộn, không phải số in sẵn trong PDF). */
  labelLine: TextLine;
  /** Số ký tự của chuỗi khớp "Câu N." (kể cả dấu chấm/hai chấm), dùng để tính điểm cắt theo
   * toạ độ TỪNG KÝ TỰ (xem eraseQuestionLabels trong questionPipeline.ts). */
  labelLength: number;
  /** Chỉ có ở nhánh phân đoạn bằng AI thị giác (PDF không có lớp chữ, xem visionSegment.ts):
   * cạnh phải (đơn vị pt) của CHÍNH nhãn "Câu N" do AI khoanh vùng — dùng làm điểm cắt tẩy nhãn
   * khi không có toạ độ từng ký tự để tính chính xác hơn. */
  labelBoxX1?: number;
}

export type SegmentResult =
  | { ok: true; title: string; blocks: QuestionBlock[]; furnitureBoxes?: { page: number; x0: number; y0: number; x1: number; y1: number }[] }
  | { ok: false; reason: string };

const Q_ANCHOR = /^\s*Câu\s*(\d+)\s*[.:)]/;
const PART_ANCHOR = /^\s*PHẦN\s+[IVXLC\d]+/;
const PAGE_NUMBER_LINE = /^\s*(Trang\s*)?\d+\s*(\/\s*\d+)?\s*$/i;
const PAD = 2;

function isFurniture(line: TextLine, pageHeight: number): boolean {
  // Số trang ở đầu/cuối trang — không thuộc về câu hỏi nào.
  if (!PAGE_NUMBER_LINE.test(line.text)) return false;
  return line.y0 > pageHeight * 0.9 || line.y1 < pageHeight * 0.08;
}

export interface Boundary {
  kind: "q" | "part";
  page: number;
  y0: number;
  number: number;
  text: string;
  line: TextLine;
  matchLength: number;
  labelBoxX1?: number;
}

/**
 * Lõi dùng chung cho cả 2 nhánh phân đoạn (lớp chữ PDF thật, hoặc AI thị giác định vị nhãn khi
 * PDF không có lớp chữ — xem visionSegment.ts): kiểm tra số thứ tự câu hợp lệ theo từng Phần,
 * rồi dựng danh sách câu + đoạn toạ độ (kể cả câu lem nhiều trang). Tách riêng khỏi việc TÌM
 * boundary (đọc dòng chữ thật hay hỏi AI) để 2 nhánh chia sẻ đúng 1 chỗ xử lý, tránh lệch logic.
 */
export function buildBlocksFromBoundaries(
  boundaries: Boundary[],
  pages: { width: number; height: number }[],
  contentBounds: { top: number; bottom: number }[]
): { ok: true; blocks: QuestionBlock[] } | { ok: false; reason: string } {
  const questionAnchors = boundaries.filter((b) => b.kind === "q");
  if (questionAnchors.length === 0) return { ok: false, reason: "Không tìm thấy nhãn 'Câu N'" };

  // Kiểm tra liên tục theo TỪNG NHÓM giữa 2 nhãn "PHẦN" (thay vì toàn bài): đề thi có thể đánh
  // số liên tục xuyên suốt (1,2,3...12,13,14...) HOẶC đánh số lại từ 1 ở mỗi Phần (chuẩn THPT
  // 2025 phổ biến: "Phần II. ... thí sinh trả lời từ câu 1 đến câu 4") — cả hai đều hợp lệ.
  const groups: Boundary[][] = [];
  let currentGroup: Boundary[] = [];
  for (const b of boundaries) {
    if (b.kind === "part") {
      if (currentGroup.length) groups.push(currentGroup);
      currentGroup = [];
      continue;
    }
    currentGroup.push(b);
  }
  if (currentGroup.length) groups.push(currentGroup);

  let prevGroupLast = 0;
  for (const group of groups) {
    const expectedStarts = prevGroupLast === 0 ? [1] : [1, prevGroupLast + 1];
    if (!expectedStarts.includes(group[0].number)) {
      return {
        ok: false,
        reason: `Số thứ tự câu không hợp lệ (gặp "Câu ${group[0].number}" ngay sau nhãn Phần, trong khi cần bắt đầu từ Câu 1 hoặc tiếp nối Câu ${prevGroupLast + 1}) — có thể bố cục hai cột hoặc thiếu nhãn`,
      };
    }
    for (let i = 1; i < group.length; i++) {
      if (group[i].number !== group[i - 1].number + 1) {
        return {
          ok: false,
          reason: `Số thứ tự câu không liên tục (gặp "Câu ${group[i].number}" ngay sau "Câu ${group[i - 1].number}") — có thể bố cục hai cột hoặc thiếu nhãn`,
        };
      }
    }
    prevGroupLast = group[group.length - 1].number;
  }

  const clamp = (v: number, h: number) => Math.max(0, Math.min(h, v));
  const lastPage = pages.length - 1;

  const blocks: QuestionBlock[] = [];
  let currentPart: string | null = null;
  for (let k = 0; k < boundaries.length; k++) {
    const a = boundaries[k];
    if (a.kind === "part") {
      currentPart = a.text;
      continue;
    }
    const next = boundaries[k + 1];
    const segments: Segment[] = [];
    const startY = clamp(a.y0 - PAD, pages[a.page].height);

    if (next && next.page === a.page) {
      segments.push({ page: a.page, y0: startY, y1: clamp(next.y0 - PAD, pages[a.page].height) });
    } else {
      // Câu kéo sang trang sau (hoặc là câu cuối đề): đoạn cuối trang đầu + các trang giữa + đầu trang cuối.
      const endPage = next ? next.page : lastPage;
      segments.push({ page: a.page, y0: startY, y1: clamp(contentBounds[a.page].bottom + PAD, pages[a.page].height) });
      for (let p = a.page + 1; p < endPage; p++) {
        segments.push({
          page: p,
          y0: clamp(contentBounds[p].top - PAD, pages[p].height),
          y1: clamp(contentBounds[p].bottom + PAD, pages[p].height),
        });
      }
      if (endPage > a.page) {
        const endY = next ? next.y0 : contentBounds[endPage].bottom;
        // Chỉ thêm đoạn đầu trang kế nếu thật sự có chữ phía trên neo kế tiếp (tránh đoạn trống).
        if (endY - contentBounds[endPage].top > 12) {
          segments.push({
            page: endPage,
            y0: clamp(contentBounds[endPage].top - PAD, pages[endPage].height),
            y1: clamp((next ? next.y0 - PAD : contentBounds[endPage].bottom + PAD), pages[endPage].height),
          });
        }
      }
    }
    blocks.push({ number: a.number, part: currentPart, segments, labelLine: a.line, labelLength: a.matchLength, labelBoxX1: a.labelBoxX1 });
  }

  return { ok: true, blocks };
}

/** Dòng chữ giống hệt nhau (vd banner quảng cáo/thương hiệu, header/footer lặp lại) xuất hiện
 * trên từ 2 TRANG KHÁC NHAU trở lên — không phải nội dung câu hỏi thật (câu hỏi không bao giờ
 * lặp lại nguyên văn giữa các trang) nên coi là "đồ trang trí" giống số trang, loại khỏi vùng
 * nội dung. Tổng quát cho MỌI file PDF, không chỉ riêng 1 mẫu cụ thể (đã gặp thực tế: banner
 * "TÀI LIỆU LUYỆN THI..." là CHỮ THẬT trong lớp chữ, không phải ảnh, lặp lại y hệt ở đầu mỗi
 * trang, khiến thuật toán coi nó là nội dung thật rồi lẫn vào ảnh cắt của câu hỏi liền kề). Chỉ
 * xét dòng đủ dài (≥10 ký tự) để tránh lầm các nhãn/ký hiệu ngắn trùng lặp ngẫu nhiên.
 */
function findRepeatedAcrossPages(pages: PageLines[]): Set<string> {
  const pagesContainingText = new Map<string, Set<number>>();
  pages.forEach((p, pageIndex) => {
    for (const line of p.lines) {
      const key = line.text.normalize("NFC").trim();
      if (key.length < 10) continue;
      if (!pagesContainingText.has(key)) pagesContainingText.set(key, new Set());
      pagesContainingText.get(key)!.add(pageIndex);
    }
  });
  const repeated = new Set<string>();
  for (const [key, pageSet] of pagesContainingText) {
    if (pageSet.size >= 2) repeated.add(key);
  }
  return repeated;
}

/** Ảnh lặp lại cùng vị trí giữa các trang thường là banner/header/footer, không phải hình
 * minh họa của câu. Chỉ dùng toạ độ dọc để chịu được sai lệch nhỏ ở chiều ngang. */
function findFurnitureImageBlocks(pages: PageLines[]): Set<string> {
  const key = (block: ImageBlock) => `${Math.round(block.y0)}-${Math.round(block.y1)}`;
  const pagesContainingBlock = new Map<string, Set<number>>();
  pages.forEach((page, pageIndex) => {
    for (const block of page.imageBlocks ?? []) {
      const blockKey = key(block);
      if (!pagesContainingBlock.has(blockKey)) pagesContainingBlock.set(blockKey, new Set());
      pagesContainingBlock.get(blockKey)!.add(pageIndex);
    }
  });
  const furniture = new Set<string>();
  for (const [blockKey, pageSet] of pagesContainingBlock) {
    if (pageSet.size >= 2) furniture.add(blockKey);
  }
  return furniture;
}

export function segmentFromLines(pages: PageLines[]): SegmentResult {
  if (pages.length === 0) return { ok: false, reason: "PDF không có trang nào" };

  const repeatedLines = findRepeatedAcrossPages(pages);
  const furnitureImageBlocks = findFurnitureImageBlocks(pages);

  // Vùng nội dung từng trang (bỏ số trang + banner/header/footer lặp lại) + dòng đã sắp theo
  // thứ tự đọc.
  const content = pages.map((p) => {
    const lines = p.lines
      .map((l) => ({ ...l, text: l.text.normalize("NFC") }))
      .filter((l) => l.text.trim().length > 0 && !isFurniture(l, p.height) && !repeatedLines.has(l.text.trim()))
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const contentImageBlocks = (p.imageBlocks ?? []).filter((block) => {
      const key = `${Math.round(block.y0)}-${Math.round(block.y1)}`;
      if (furnitureImageBlocks.has(key)) return false;
      // A near full-page image is normally a scanned background, not a question figure.
      return block.y1 - block.y0 <= p.height * 0.75;
    });
    const imageTop = contentImageBlocks.length ? Math.min(...contentImageBlocks.map((b) => b.y0)) : Infinity;
    const imageBottom = contentImageBlocks.length ? Math.max(...contentImageBlocks.map((b) => b.y1)) : -Infinity;
    const textTop = lines.length ? Math.min(...lines.map((l) => l.y0)) : Infinity;
    const textBottom = lines.length ? Math.max(...lines.map((l) => l.y1)) : -Infinity;
    const top = Math.min(textTop, imageTop);
    const bottom = Math.max(textBottom, imageBottom);
    return {
      lines,
      top: top === Infinity ? 0 : top,
      bottom: bottom === -Infinity ? p.height : bottom,
    };
  });

  const totalChars = content.reduce((n, c) => n + c.lines.reduce((m, l) => m + l.text.length, 0), 0);
  if (totalChars < 200) return { ok: false, reason: "PDF không có lớp chữ (có thể là bản quét/ảnh)" };

  // Neo câu hỏi và neo tiêu đề phần, theo thứ tự đọc.
  const boundaries: Boundary[] = [];
  content.forEach((c, pageIndex) => {
    for (const line of c.lines) {
      if (line.x0 > pages[pageIndex].width * 0.4) continue; // nhãn câu luôn nằm sát lề trái
      const q = Q_ANCHOR.exec(line.text);
      if (q) {
        boundaries.push({ kind: "q", page: pageIndex, y0: line.y0, number: Number(q[1]), text: line.text.trim(), line, matchLength: q[0].length });
        continue;
      }
      if (PART_ANCHOR.test(line.text)) {
        boundaries.push({ kind: "part", page: pageIndex, y0: line.y0, number: 0, text: line.text.trim(), line, matchLength: 0 });
      }
    }
  });

  if (boundaries.filter((b) => b.kind === "q").length === 0) {
    return { ok: false, reason: "Không tìm thấy nhãn 'Câu N' trong lớp chữ" };
  }

  const built = buildBlocksFromBoundaries(
    boundaries,
    pages,
    content.map((c) => ({ top: c.top, bottom: c.bottom }))
  );
  if (!built.ok) return built;

  // Tiêu đề đề thi: dòng chữ đầu tiên của trang 1 nằm trước nhãn đầu tiên.
  const firstBoundaryY = boundaries[0].page === 0 ? boundaries[0].y0 : Infinity;
  const titleLine = content[0].lines.find((l) => l.y0 < firstBoundaryY && !PART_ANCHOR.test(l.text));
  return { ok: true, title: titleLine ? titleLine.text.trim() : "", blocks: built.blocks };
}
