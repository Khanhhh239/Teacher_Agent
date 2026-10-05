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

// Cố tình KHÔNG hỏi AI số thứ tự câu là mấy — chỉ hỏi VỊ TRÍ. Đã kiểm chứng thực tế: dù layout
// đơn giản (1 cột), model vẫn có lúc đọc nhầm chữ số trên nhãn (vd lẫn "Câu 3" ra sau "Câu 6"),
// làm hỏng cả bước kiểm tra liên tục. Số thứ tự thật được TỰ ĐÁNH bằng code theo đúng thứ tự
// toạ độ (trên→dưới, trái→phải) sau khi định vị xong — loại bỏ hoàn toàn rủi ro đọc sai số.
const LABEL_DETECT_PROMPT = `Ảnh đính kèm là 1 TRANG đề thi gốc, không có lớp phủ hay lưới.
Hãy ưu tiên nhận diện ĐẦY ĐỦ mọi nhãn câu theo vị trí từ trên xuống dưới; không được bỏ sót nhãn chỉ vì chữ nhỏ,
hình minh họa hoặc câu hỏi nằm sát nhau.

Nhiệm vụ DUY NHẤT: tìm VỊ TRÍ (toạ độ) của:
1. Mỗi nhãn MỞ ĐẦU một câu hỏi mới, dạng "Câu <số>." hoặc "Câu <số>:" hoặc "Câu <số>)" — nhãn này luôn nằm sát lề trái, ở đầu dòng. KHÔNG tính chữ "câu" xuất hiện giữa câu văn (vd "mỗi câu hỏi", "các câu sau").
2. Mỗi tiêu đề phần thi, dạng "PHẦN <số La Mã>..." (vd "PHẦN I. Câu trắc nghiệm...").

TUYỆT ĐỐI KHÔNG đọc, không chép lại, không diễn giải nội dung câu hỏi, KHÔNG CẦN đọc số thứ tự ghi trên nhãn — chỉ cần xác định toạ độ của riêng cụm nhãn đó (vd chỉ khoanh đúng "Câu 5:" chứ không khoanh cả câu hỏi phía sau).

Trả về DUY NHẤT 1 JSON, không markdown, không code fence, theo schema:
{
  "labels": [
    {"kind": "q", "box_2d": [120, 40, 145, 95]},
    {"kind": "part", "box_2d": [300, 30, 328, 420]}
  ]
}
"box_2d" là [ymin, xmin, ymax, xmax] CHUẨN HÓA theo thang 0-1000 của ảnh gốc. Hãy khoanh SÁT chữ nhãn, không lấy ký tự đầu của nội dung ngay sau nhãn.
Sắp xếp các phần tử theo đúng thứ tự xuất hiện trên trang, từ trên xuống dưới. Nếu trang không có nhãn nào, trả {"labels": []}.`;

interface RawVisionLabel {
  kind: "q" | "part";
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

const DEFAULT_DETECTION_ATTEMPTS = 3;
/** 2 nhãn cách nhau dưới ngần này (thang 0-1000 theo chiều cao trang) coi là "cùng 1 nhãn". */
const CLUSTER_Y_TOLERANCE = 12;

/**
 * Gọi AI NHIỀU LẦN ĐỘC LẬP cho 1 trang rồi BIỂU QUYẾT theo vị trí — đã kiểm chứng thực tế là
 * cách duy nhất vừa vá được nhãn bị BỎ SÓT (chỉ cần ≥1 lần trong N lần tìm thấy là có cơ hội
 * được giữ) vừa loại được nhãn ẢO do model tự nhận bừa (một nhãn chỉ 1/N lần xuất hiện, không
 * lần nào khác đồng ý vị trí đó, sẽ bị loại vì không đủ đa số). Cách trước đó (chọn nguyên 1
 * lượt gọi tìm được NHIỀU nhãn hơn) vẫn dính lỗi: lượt đó có thể lẫn 1 nhãn ảo.
 */
async function detectPageLabelsByVoting(
  pageImage: Buffer,
  warnings: string[] | undefined,
  deadline: number | undefined,
  detectionAttempts: number
): Promise<RawVisionLabel[]> {
  const attempts = await Promise.all(
    Array.from({ length: detectionAttempts }, () => detectPageLabels(pageImage, warnings, deadline))
  );

  function clusterAndVote(kind: "q" | "part"): [number, number, number, number][] {
    const candidates: { runIdx: number; box: [number, number, number, number] }[] = [];
    attempts.forEach((labels, runIdx) => {
      for (const l of labels) {
        if (l.kind === kind && Array.isArray(l.box_2d) && l.box_2d.length === 4) {
          candidates.push({ runIdx, box: l.box_2d });
        }
      }
    });
    candidates.sort((a, b) => a.box[0] - b.box[0]);

    const clusters: { items: typeof candidates; runs: Set<number> }[] = [];
    for (const item of candidates) {
      const last = clusters[clusters.length - 1];
      const lastY = last?.items[last.items.length - 1]?.box[0];
      if (last && lastY !== undefined && item.box[0] - lastY <= CLUSTER_Y_TOLERANCE && !last.runs.has(item.runIdx)) {
        last.items.push(item);
        last.runs.add(item.runIdx);
      } else {
        clusters.push({ items: [item], runs: new Set([item.runIdx]) });
      }
    }

    // Với 3 lượt cần ít nhất 2 lượt đồng ý. Nhánh fallback vẫn chịu được cấu hình ít lượt hơn
    // nếu sau này cần tối ưu deadline lần nữa.
    const majority = detectionAttempts >= 3 ? 2 : 1;
    const median = (nums: number[]) => {
      const s = [...nums].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    return clusters
      .filter((c) => c.runs.size >= majority)
      .map((c): [number, number, number, number] => [
        median(c.items.map((i) => i.box[0])),
        median(c.items.map((i) => i.box[1])),
        median(c.items.map((i) => i.box[2])),
        median(c.items.map((i) => i.box[3])),
      ]);
  }

  const qBoxes = clusterAndVote("q").map((box): RawVisionLabel => ({ kind: "q", box_2d: box }));
  const partBoxes = clusterAndVote("part").map((box): RawVisionLabel => ({ kind: "part", box_2d: box }));
  return [...qBoxes, ...partBoxes].sort((a, b) => a.box_2d[0] - b.box_2d[0]);
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

  const detectionAttempts = DEFAULT_DETECTION_ATTEMPTS;
  // Gọi AI 3 lượt độc lập mỗi trang rồi biểu quyết theo vị trí. Deadline của route vẫn chặn
  // việc chờ vô hạn, nhưng không hạ chất lượng định vị khi người dùng chấp nhận chờ lâu hơn.
  const perPageLabels = await Promise.all(
    pageImages.map((img) => detectPageLabelsByVoting(img, warnings, deadline, detectionAttempts))
  );

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
      // number/text thật gán lại NGAY SAU KHI sắp xếp bên dưới — ở đây chỉ giữ chỗ toạ độ.
      const line: TextLine = { text: "", x0, y0, x1, y1 };
      if (l.kind === "q") {
        boundaries.push({ kind: "q", page: pageIndex, y0, number: 0, text: "", line, matchLength: 0, labelBoxX1: x1 });
      } else if (l.kind === "part") {
        boundaries.push({ kind: "part", page: pageIndex, y0, number: 0, text: "", line, matchLength: 0 });
      }
    }
  });
  // Sắp đúng thứ tự đọc (trên → dưới mỗi trang, theo đúng thứ tự trang).
  boundaries.sort((a, b) => a.page - b.page || a.y0 - b.y0);

  // QUAN TRỌNG: KHÔNG dùng số AI đọc được (nếu có) — đã kiểm chứng thực tế model đôi khi đọc
  // nhầm chữ số ngay cả với layout 1 cột đơn giản (vd trả về thứ tự "Câu 3" lẫn sau "Câu 6"),
  // làm hỏng bước kiểm tra liên tục bên dưới dù định vị TOẠ ĐỘ vẫn đúng. Tự đánh số theo đúng
  // thứ tự xuất hiện (reset về 1 sau mỗi "PHẦN") loại bỏ hoàn toàn rủi ro đọc sai chữ số — và
  // tương tự, mỗi "PHẦN" được gán nhãn phân biệt PHẦN 1/2/3 theo thứ tự, không phụ thuộc AI đọc
  // đúng số La Mã (lỗi khác đã gặp: mọi Phần bị gán cùng 1 chuỗi, khiến xáo bài lẫn lộn giữa
  // các Phần).
  let partSeq = 0;
  let qSeqInPart = 0;
  for (const b of boundaries) {
    if (b.kind === "part") {
      partSeq += 1;
      qSeqInPart = 0;
      b.text = `PHẦN ${partSeq}`;
    } else {
      qSeqInPart += 1;
      b.number = qSeqInPart;
      b.text = `Câu ${qSeqInPart}.`;
      b.line.text = b.text;
      b.matchLength = b.text.length;
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
