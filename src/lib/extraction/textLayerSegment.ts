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

export interface PageLines {
  width: number;
  height: number;
  lines: TextLine[];
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
}

export type SegmentResult =
  | { ok: true; title: string; blocks: QuestionBlock[] }
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

interface Boundary {
  kind: "q" | "part";
  page: number;
  y0: number;
  number: number;
  text: string;
  line: TextLine;
  matchLength: number;
}

export function segmentFromLines(pages: PageLines[]): SegmentResult {
  if (pages.length === 0) return { ok: false, reason: "PDF không có trang nào" };

  // Vùng nội dung từng trang (bỏ số trang) + dòng đã sắp theo thứ tự đọc.
  const content = pages.map((p) => {
    const lines = p.lines
      .map((l) => ({ ...l, text: l.text.normalize("NFC") }))
      .filter((l) => l.text.trim().length > 0 && !isFurniture(l, p.height))
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    return {
      lines,
      top: lines.length ? Math.min(...lines.map((l) => l.y0)) : 0,
      bottom: lines.length ? Math.max(...lines.map((l) => l.y1)) : p.height,
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

  const questionAnchors = boundaries.filter((b) => b.kind === "q");
  if (questionAnchors.length === 0) return { ok: false, reason: "Không tìm thấy nhãn 'Câu N' trong lớp chữ" };
  for (let i = 0; i < questionAnchors.length; i++) {
    if (questionAnchors[i].number !== i + 1) {
      return {
        ok: false,
        reason: `Số thứ tự câu không liên tục (vị trí ${i + 1} đọc ra "Câu ${questionAnchors[i].number}") — có thể bố cục hai cột hoặc thiếu nhãn`,
      };
    }
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
      segments.push({ page: a.page, y0: startY, y1: clamp(content[a.page].bottom + PAD, pages[a.page].height) });
      for (let p = a.page + 1; p < endPage; p++) {
        segments.push({
          page: p,
          y0: clamp(content[p].top - PAD, pages[p].height),
          y1: clamp(content[p].bottom + PAD, pages[p].height),
        });
      }
      if (endPage > a.page) {
        const endY = next ? next.y0 : content[endPage].bottom;
        // Chỉ thêm đoạn đầu trang kế nếu thật sự có chữ phía trên neo kế tiếp (tránh đoạn trống).
        if (endY - content[endPage].top > 12) {
          segments.push({
            page: endPage,
            y0: clamp(content[endPage].top - PAD, pages[endPage].height),
            y1: clamp((next ? next.y0 - PAD : content[endPage].bottom + PAD), pages[endPage].height),
          });
        }
      }
    }
    blocks.push({ number: a.number, part: currentPart, segments, labelLine: a.line, labelLength: a.matchLength });
  }

  // Tiêu đề đề thi: dòng chữ đầu tiên của trang 1 nằm trước nhãn đầu tiên.
  const firstBoundaryY = boundaries[0].page === 0 ? boundaries[0].y0 : Infinity;
  const titleLine = content[0].lines.find((l) => l.y0 < firstBoundaryY && !PART_ANCHOR.test(l.text));
  return { ok: true, title: titleLine ? titleLine.text.trim() : "", blocks };
}
