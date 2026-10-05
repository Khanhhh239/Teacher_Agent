/**
 * Vẽ "thước toạ độ" lên một BẢN SAO của ảnh để AI đọc khung hình (figure bbox) chính xác hơn,
 * theo đúng yêu cầu: lưới KHÔNG được chèn chữ vào vùng nội dung — mọi chữ số chỉ nằm trong lề
 * (gutter) quanh ảnh, vùng nội dung chỉ có đường kẻ mờ không chữ.
 *
 * Chữ số vẽ bằng lưới điểm ảnh (bitmap font, toàn hình chữ nhật — KHÔNG dùng <text>/font chữ)
 * vì `sharp` dựng SVG qua librsvg và Vercel không có sẵn font hệ thống: <text> từng cho ra ô
 * vuông/chữ rác trên Vercel dù chạy đúng trên máy Windows (đã gặp thật khi thử render WMF).
 * Rect thì không phụ thuộc font nào, chắc chắn giống nhau trên mọi máy chủ.
 *
 * Bản vẽ lưới CHỈ dùng để lấy khung (figure bbox) — không bao giờ dùng để cắt ảnh hay đọc nội
 * dung chữ; cắt ảnh luôn thực hiện trên ảnh gốc sạch (xem buildGridOverlay -> dùng result.contentLeft/Top
 * để quy đổi khung ảnh lưới về đúng pixel của ảnh gốc).
 */

// Bitmap 3x5 cho chữ số 0-9 (1 = có điểm, hàng trên xuống dưới).
const DIGIT_FONT: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

function digitRects(text: string, x: number, y: number, px: number, color: string): string {
  const gap = px; // khoảng cách giữa các chữ số
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const glyph = DIGIT_FONT[text[i]];
    if (!glyph) continue;
    const ox = x + i * (3 * px + gap);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (glyph[r][c] === "1") {
          out += `<rect x="${ox + c * px}" y="${y + r * px}" width="${px}" height="${px}" fill="${color}"/>`;
        }
      }
    }
  }
  return out;
}

export interface GridOverlayResult {
  /** Ảnh PNG đã vẽ thước — CHỈ dùng để gọi AI lấy khung, không dùng để cắt/đọc nội dung. */
  png: Buffer;
  gutter: number;
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  contentHeight: number;
}

/**
 * Vẽ thước 0-1000 quanh `image` (ảnh sạch, không chỉnh sửa): lề trắng ở 4 cạnh chứa vạch +
 * số (0,100,...,1000), và lưới kẻ mờ mỗi 100 đơn vị NẰM TRONG vùng nội dung (không có chữ).
 * Toạ độ AI trả về theo đúng thang 0-1000 của VÙNG NỘI DUNG (không tính lề) — quy đổi sang
 * pixel ảnh gốc: `px = contentLeft/Top + (giá_trị/1000) * contentWidth/Height`.
 */
export async function buildGridOverlay(
  image: Buffer,
  opts: { step?: number; labelEvery?: number; lineAlpha?: number } = {}
): Promise<GridOverlayResult> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const gutter = Math.max(70, Math.round(Math.max(W, H) * 0.045));
  const step = opts.step ?? 20; // vạch nhỏ nhất 20/1000; dùng 2pt ở vùng cỡ trang A4
  const labelEvery = opts.labelEvery ?? 100; // chỉ ghi số lớn mỗi 100/1000 để tránh rối ảnh
  const lineAlpha = opts.lineAlpha ?? 0.3;

  const canvasW = W + gutter * 2;
  const canvasH = H + gutter * 2;
  const px = Math.max(2, Math.round(gutter / 24)); // kích thước 1 "điểm" của chữ số, theo lề

  let lines = "";
  let labels = "";
  for (let v = 0; v <= 1000; v += step) {
    const x = gutter + (v / 1000) * W;
    const y = gutter + (v / 1000) * H;
    // Lưới dọc/ngang mờ, CHỈ trong vùng nội dung [gutter, gutter+W] x [gutter, gutter+H].
    lines += `<line x1="${x}" y1="${gutter}" x2="${x}" y2="${gutter + H}" stroke="red" stroke-width="1" stroke-opacity="${lineAlpha}"/>`;
    lines += `<line x1="${gutter}" y1="${y}" x2="${gutter + W}" y2="${y}" stroke="red" stroke-width="1" stroke-opacity="${lineAlpha}"/>`;
    // Vạch số: chỉ nằm trong lề, không bao giờ lấn vào vùng nội dung.
    if (v % labelEvery === 0 || v === 1000) {
      const label = String(v);
      const labelW = label.length * (3 * px + px) - px;
      labels += digitRects(label, Math.round(x - labelW / 2), Math.round(gutter - px * 7), px, "#b00000");
      labels += digitRects(label, Math.round(x - labelW / 2), Math.round(gutter + H + px * 2), px, "#b00000");
      labels += digitRects(label, Math.round(gutter - px * 3 - labelW), Math.round(y - px * 2.5), px, "#b00000");
      labels += digitRects(label, Math.round(gutter + W + px * 3), Math.round(y - px * 2.5), px, "#b00000");
    }
  }

  const overlaySvg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="white"/>
    ${lines}
    <rect x="${gutter - 1}" y="${gutter - 1}" width="${W + 2}" height="${H + 2}" fill="none" stroke="red" stroke-opacity="0.5" stroke-width="1"/>
    ${labels}
  </svg>`;

  const png = await sharp(Buffer.from(overlaySvg))
    .composite([{ input: image, left: gutter, top: gutter }])
    .png()
    .toBuffer();

  return { png, gutter, contentLeft: gutter, contentTop: gutter, contentWidth: W, contentHeight: H };
}

/** Quy đổi 1 khung [x0,y0,x1,y1] theo thang 0-1000 của VÙNG NỘI DUNG về pixel của ảnh gốc sạch. */
export function gridBoxToPixels(
  bbox: [number, number, number, number],
  g: Pick<GridOverlayResult, "contentWidth" | "contentHeight">
): { left: number; top: number; width: number; height: number } {
  const [x0, y0, x1, y1] = bbox;
  const left = Math.round((x0 / 1000) * g.contentWidth);
  const top = Math.round((y0 / 1000) * g.contentHeight);
  const width = Math.round(((x1 - x0) / 1000) * g.contentWidth);
  const height = Math.round(((y1 - y0) / 1000) * g.contentHeight);
  return { left, top, width, height };
}
