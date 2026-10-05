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

/** Xóa dải banner trang trí lặp lại ở chân trang khỏi ảnh render trước khi crop câu hỏi.
 * Banner của một số PDF nằm trong ảnh nền toàn trang nên không xuất hiện trong text layer hoặc
 * structured-text image blocks. Chỉ che một dải nếu phát hiện cùng vị trí tương đối trên ít nhất
 * hai trang, tránh làm mất hình minh họa màu xanh chỉ xuất hiện ở một câu. */
export async function removeRepeatedBanners(pagePngs: Buffer[]): Promise<Buffer[]> {
  if (pagePngs.length < 2) return pagePngs;
  const sharp = (await import("sharp")).default;
  const decoded = await Promise.all(
    pagePngs.map(async (png) => {
      const result = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      return { png, data: result.data, width: result.info.width, height: result.info.height, channels: result.info.channels };
    })
  );

  type Band = { start: number; end: number; xStart: number; coverage: number };
  const bandsByPage: Band[][] = decoded.map(({ data, width, height, channels }) => {
    const rows: number[] = [];
    // Một số PDF đặt banner ở khoảng 70-80% trang, không hẳn sát chân trang. Quét từ
    // 55% để bắt đủ các dải đó; phía dưới vẫn phải lặp ở ít nhất 2 trang mới được che,
    // nên hình minh họa màu xanh chỉ xuất hiện ở một câu không bị ảnh hưởng.
    for (let y = Math.floor(height * 0.55); y < height; y++) {
      let bluePixels = 0;
      for (let x = Math.floor(width * 0.5); x < width; x++) {
        const i = (y * width + x) * channels;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (b > 90 && b > r * 1.25 && b > g * 1.05) bluePixels++;
      }
      if (bluePixels > width * 0.06) rows.push(y);
    }

    const groups: Array<[number, number]> = [];
    for (const y of rows) {
      const last = groups[groups.length - 1];
      if (last && y <= last[1] + 2) last[1] = y;
      else groups.push([y, y]);
    }
    return groups
      // Banner có thể chỉ dày vài pixel sau khi render, nhất là PDF xuất từ ảnh ghép.
      // Không dùng ngưỡng dày cố định theo một mẫu đề duy nhất.
      .filter(([start, end]) => end - start >= Math.max(3, height * 0.006))
      .map(([start, end]) => {
        let xStart = width;
        let maxCoverage = 0;
        for (let y = start; y <= end; y++) {
          let rowBlue = 0;
          for (let x = Math.floor(width * 0.4); x < width; x++) {
            const i = (y * width + x) * channels;
            const r = data[i] ?? 0;
            const g = data[i + 1] ?? 0;
            const b = data[i + 2] ?? 0;
            if (b > 90 && b > r * 1.25 && b > g * 1.05) {
              xStart = Math.min(xStart, x);
              rowBlue++;
            }
          }
          maxCoverage = Math.max(maxCoverage, rowBlue / width);
        }
        return { start: start / height, end: end / height, xStart: xStart / width, coverage: maxCoverage };
      });
  });

  const repeatedBands: Band[] = [];
  const resemblesSameBanner = (a: Band, b: Band) => {
    const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
    const verticalOverlap = union > 0 ? overlap / union : 0;
    return (
      (verticalOverlap >= 0.35 || (Math.abs(a.start - b.start) < 0.08 && Math.abs(a.end - b.end) < 0.08)) &&
      Math.abs(a.xStart - b.xStart) < 0.12 &&
      Math.abs(a.coverage - b.coverage) < 0.35
    );
  };

  for (const band of bandsByPage.flat()) {
    const appearances = bandsByPage.reduce(
      (count, pageBands) =>
        count + (pageBands.some((other) => resemblesSameBanner(other, band)) ? 1 : 0),
      0
    );
    if (appearances >= 2 && !repeatedBands.some((other) => resemblesSameBanner(other, band))) {
      repeatedBands.push(band);
    }
  }
  if (repeatedBands.length === 0) return pagePngs;

  return Promise.all(
    decoded.map(async ({ png, width, height }, pageIndex) => {
      const masks = bandsByPage[pageIndex]
        .filter((band) => repeatedBands.some((other) => resemblesSameBanner(other, band)))
        .map((band) => {
          const top = Math.max(0, Math.floor(band.start * height) - 5);
          const bottom = Math.min(height, Math.ceil(band.end * height) + 6);
          const left = Math.max(0, Math.floor(band.xStart * width) - 8);
          return `<rect x="${left}" y="${top}" width="${width - left}" height="${bottom - top}" fill="white"/>`;
        });
      if (masks.length === 0) return png;
      return sharp(png)
        .composite([{ input: Buffer.from(`<svg width="${width}" height="${height}">${masks.join("")}</svg>`), left: 0, top: 0 }])
        .png()
        .toBuffer();
    })
  );
}
