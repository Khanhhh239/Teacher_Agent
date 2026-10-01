import * as mupdf from "mupdf";

/**
 * Render từng trang PDF ra ảnh PNG (dùng để: 1. gửi Gemini vision đọc nội dung + xác định
 * vị trí hình vẽ, 2. cắt hình vẽ theo bbox Gemini trả về). Dùng mupdf (WASM, không phải
 * native binary) thay vì pdfjs-dist + @napi-rs/canvas — tổ hợp đó gây segfault thực tế khi
 * test trên Windows, mupdf an toàn hơn cho môi trường serverless.
 */
export function renderPdfPages(buffer: Buffer, dpi = 200): Buffer[] {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();
  const zoom = dpi / 72;
  const matrix = mupdf.Matrix.scale(zoom, zoom);

  const pages: Buffer[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    pages.push(Buffer.from(pixmap.asPNG()));
  }
  return pages;
}
