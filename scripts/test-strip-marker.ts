import { normalizeExtractedExam } from "../src/lib/extraction/normalize";

const broken = {
  title: "test",
  subject: "Toán",
  questions: [
    {
      type: "short_answer",
      content_latex:
        "Sau đó khoét bỏ... (xem hình dưới). [IMAGE:figure_8.jpg] [IMAGE:figure_9.jpg] Thể tích của khối chân đế bằng bao nhiêu.",
      image_urls: ["figure_8.jpg", "figure_9.jpg"],
      options: [],
      sub_statements: [],
      correct_answer: null,
      short_answer_normalized: "96.5",
      score_rule: "standard",
      max_score: 0.5,
      raw_ocr_notes: null,
    },
  ],
};

const result = normalizeExtractedExam(broken);
const q = result.questions[0];
console.log("content_latex:", JSON.stringify(q.content_latex));
console.log("image_urls:", q.image_urls);
console.log("Still contains marker:", q.content_latex.includes("IMAGE:"));
