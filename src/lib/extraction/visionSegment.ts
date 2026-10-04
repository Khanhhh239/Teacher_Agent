/**
 * Phân đoạn đề thi khi PDF KHÔNG có lớp chữ thật (vd PDF chính thức ghép từ nhiều dải ảnh,
 * không phải bản quét giấy mà là file "PDF_IMAGE_ONLY" — xem docs/KE_HOACH_SO_HOA_VA_SAN_PHAM.md
 * mục khảo sát 3 nhánh input). Nhánh lớp-chữ (textLayerSegment.ts) luôn được thử TRƯỚC và là
 * nhánh chính (miễn phí, không AI) — nhánh này chỉ chạy khi nhánh đó thất bại vì thiếu lớp chữ.
 *
 * AI chỉ được hỏi ĐÚNG MỘT VIỆC: nhãn "Câu N"/"PHẦN ..." nằm ở TOẠ ĐỘ nào trên ảnh trang — tuyệt
 * đối KHÔNG đọc/chép nội dung câu hỏi. Sau khi có toạ độ, phần còn lại (cắt ảnh, ghép câu lem
 * trang, tẩy nhãn gốc) dùng lại NGUYÊN logic của buildBlocksFromBoundaries — nội dung hiển thị
 * cho học sinh vẫn là ẢNH GỐC 100%, không có bước nào AI "chép lại" nội dung cả.
 */
import { callGeminiWithImage, extractJson } from "./llmClient";
import { buildBlocksFromBoundaries, type Boundary, type SegmentResult, type TextLine } from "./textLayerSegment";

const VISION_LABEL_MODEL = "gemini-3.5-flash-lite";

const LABEL_DETECT_PROMPT = `Ảnh đính kèm là 1 TRANG đề thi. Nhiệm vụ DUY NHẤT: tìm VỊ TRÍ (toạ độ) của:
1. Mỗi nhãn MỞ ĐẦU một câu hỏi mới, dạng "Câu <số>." hoặc "Câu <số>:" hoặc "Câu <số>)" — nhãn này luôn nằm sát lề trái, ở đầu dòng. KHÔNG tính chữ "câu" xuất hiện giữa câu văn (vd "mỗi câu hỏi", "các câu sau").
2. Mỗi tiêu đề phần thi, dạng "PHẦN <số La Mã>..." (vd "PHẦN I. Câu trắc nghiệm...").

TUYỆT ĐỐI KHÔNG đọc, không chép lại, không diễn giải nội dung câu hỏi — chỉ xác định toạ độ của riêng cụm nhãn đó (vd chỉ khoanh đúng "Câu 5:" chứ không khoanh cả câu hỏi phía sau).

Trả về DUY NHẤT 1 JSON, không markdown, không code fence, theo schema:
{
  "labels": [
    {"kind": "q", "number": 5, "box_2d": [120, 40, 145, 95]},
    {"kind": "part", "box_2d": [300, 30, 328, 420]}
  ]
}
"box_2d" là [ymin, xmin, ymax, xmax] CHUẨN HÓA theo thang 0-1000 so với kích thước ảnh (quy ước chuẩn). Sắp xếp các phần tử theo đúng thứ tự xuất hiện trên trang, từ trên xuống dưới. Nếu trang không có nhãn nào, trả {"labels": []}.`;

interface RawVisionLabel {
  kind: "q" | "part";
  number?: number;
  box_2d: [number, number, number, number];
}

async function detectPageLabels(
  pageImage: Buffer,
  warnings: string[] | undefined,
  deadline: number | undefined
): Promise<RawVisionLabel[]> {
  const { waitForSlot } = await import("./rateLimiter");
  const gotSlot = await waitForSlot(VISION_LABEL_MODEL, deadline);
  if (!gotSlot) {
    const msg = "Hết thời gian xử lý nên một số trang chưa định vị được câu hỏi — thử lại hoặc dùng file đề nhẹ hơn.";
    if (warnings && !warnings.includes(msg)) warnings.push(msg);
    return [];
  }
  const text = await callGeminiWithImage(pageImage.toString("base64"), LABEL_DETECT_PROMPT, "image/png", warnings, 0, VISION_LABEL_MODEL);
  const data = extractJson(text) as { labels?: RawVisionLabel[] };
  return data.labels ?? [];
}

/**
 * @param pageImages Ảnh render từng trang (PNG) — dùng CHUNG ảnh này cho cả việc định vị và
 * cắt câu sau đó, không cần render 2 lần.
 * @param pageSizesPt Kích thước thật của từng trang PDF theo đơn vị point (lấy từ mupdf bounds).
 */
export async function segmentFromVisionLabels(
  pageImages: Buffer[],
  pageSizesPt: { width: number; height: number }[],
  warnings?: string[],
  deadline?: number
): Promise<SegmentResult> {
  if (pageImages.length === 0) return { ok: false, reason: "PDF không có trang nào" };

  const perPageLabels = await Promise.all(pageImages.map((img) => detectPageLabels(img, warnings, deadline)));

  const boundaries: Boundary[] = [];
  perPageLabels.forEach((labels, pageIndex) => {
    const { width, height } = pageSizesPt[pageIndex];
    for (const l of labels) {
      if (!Array.isArray(l.box_2d) || l.box_2d.length !== 4) continue;
      const [ymin, xmin, ymax, xmax] = l.box_2d;
      const y0 = (ymin / 1000) * height;
      const y1 = (ymax / 1000) * height;
      const x0 = (xmin / 1000) * width;
      const x1 = (xmax / 1000) * width;
      const line: TextLine = { text: l.kind === "q" ? `Câu ${l.number ?? "?"}.` : "PHẦN", x0, y0, x1, y1 };
      if (l.kind === "q" && typeof l.number === "number") {
        boundaries.push({ kind: "q", page: pageIndex, y0, number: l.number, text: line.text, line, matchLength: line.text.length, labelBoxX1: x1 });
      } else if (l.kind === "part") {
        // Nhãn thật ("PHẦN " + text) gán lại NGAY SAU KHI sắp xếp bên dưới — ở đây chỉ giữ chỗ.
        boundaries.push({ kind: "part", page: pageIndex, y0, number: 0, text: "", line, matchLength: 0 });
      }
    }
  });
  // Đảm bảo đúng thứ tự đọc dù AI có lỡ trả không đúng thứ tự trong 1 trang.
  boundaries.sort((a, b) => a.page - b.page || a.y0 - b.y0);

  // QUAN TRỌNG: mỗi nhãn "PHẦN" phải có text PHÂN BIỆT — groupKey khi xáo bài
  // (seededShuffleByGroup) dựa trên đúng chuỗi part_label này. Lúc trước gán cứng cùng 1 chuỗi
  // "PHẦN" cho mọi Phần → cả đề bị coi là 1 nhóm duy nhất, xáo lẫn các loại câu khác Phần vào
  // nhau (lỗi thực tế đã gặp). Đánh số thứ tự (PHẦN 1, PHẦN 2...) để LUÔN phân biệt được, không
  // phụ thuộc AI đọc đúng số La Mã hay không — ưu tiên đúng hơn đẹp.
  let partSeq = 0;
  for (const b of boundaries) {
    if (b.kind === "part") {
      partSeq += 1;
      b.text = `PHẦN ${partSeq}`;
    }
  }

  if (boundaries.filter((b) => b.kind === "q").length === 0) {
    return { ok: false, reason: "AI không định vị được nhãn 'Câu N' nào trên các trang — thử lại hoặc kiểm tra file đề có bị mờ/nghiêng không" };
  }

  // Không có "dòng chữ thật" để biết chính xác điểm bắt đầu/kết thúc nội dung mỗi trang (khác
  // nhánh lớp chữ) — dùng toàn bộ chiều cao trang làm biên nội dung, an toàn hơn là cắt thiếu.
  const contentBounds = pageSizesPt.map((p) => ({ top: 0, bottom: p.height }));
  const built = buildBlocksFromBoundaries(boundaries, pageSizesPt, contentBounds);
  if (!built.ok) return built;

  return { ok: true, title: "", blocks: built.blocks };
}
