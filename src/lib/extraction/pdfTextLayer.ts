import type { PageLines } from "./textLayerSegment";

/** Đọc lớp chữ của PDF: toàn bộ dòng chữ + bbox (đơn vị pt) của từng trang — dùng để phân đoạn
 * (tách riêng khỏi imageQuestionPipeline.ts để llmClient.ts dùng được mà không bị import vòng). */
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
