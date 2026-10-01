import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectDocxBranch, extractDocx } from "@/lib/extraction/docxExtract";
import {
  structureExamText,
  extractPdfPages,
  extractExamFromImage,
  extractAnswerKeyFromText,
  extractAnswerKeyFromPdf,
  extractAnswerKeyFromImage,
  mergeAnswerKeyIntoQuestions,
} from "@/lib/extraction/llmClient";
import { normalizeExtractedExam } from "@/lib/extraction/normalize";

export const runtime = "nodejs";
// Gemini đôi khi mất 30-90s để sinh JSON dài (đề 20+ câu), cộng thêm tối đa 3 lần retry
// khi gặp lỗi 503 quá tải (xem llmClient.ts) — đặt cao để giảm khả năng timeout giữa
// chừng. File đáp án xử lý thêm sau file đề trong cùng 1 request nên cũng cần dư thời
// gian. Vercel Hobby cho phép cấu hình tới 300s cho Node runtime function.
export const maxDuration = 280;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const answerFile = formData.get("answer_file") as File | null;
  const durationMinutes = Number(formData.get("duration_minutes") ?? 90);
  if (!file) {
    return NextResponse.json({ error: "Thiếu file đề thi" }, { status: 400 });
  }
  if (!answerFile) {
    return NextResponse.json({ error: "Thiếu file đáp án — cần upload cả đề và đáp án" }, { status: 400 });
  }

  const ext = extOf(file.name);
  const answerExt = extOf(answerFile.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  const answerBuffer = Buffer.from(await answerFile.arrayBuffer());

  let extracted;
  let sourceBranch: string;
  let localImages: Map<string, Buffer> | null = null;
  const warnings: string[] = [];

  try {
    if (ext === "docx") {
      sourceBranch = await detectDocxBranch(buffer);
      const result = await extractDocx(buffer);
      localImages = result.images;
      warnings.push(...result.warnings);
      const structured = await structureExamText(result.text);
      extracted = normalizeExtractedExam({ ...structured, source_branch: sourceBranch });
    } else if (ext === "pdf") {
      sourceBranch = "PDF_IMAGE_ONLY";
      const { extracted: pdfExtracted, images } = await extractPdfPages(buffer);
      localImages = images;
      extracted = normalizeExtractedExam({ ...pdfExtracted, source_branch: sourceBranch });
    } else if (IMAGE_EXTS.has(ext)) {
      sourceBranch = "PDF_IMAGE_ONLY";
      const { extracted: imgExtracted, images } = await extractExamFromImage(buffer);
      localImages = images;
      extracted = normalizeExtractedExam({ ...imgExtracted, source_branch: sourceBranch });
    } else {
      return NextResponse.json({ error: "File đề thi chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Lỗi xử lý file đề thi: ${message}` }, { status: 500 });
  }

  try {
    let answerKey;
    if (answerExt === "docx") {
      const result = await extractDocx(answerBuffer);
      answerKey = await extractAnswerKeyFromText(result.text);
    } else if (answerExt === "pdf") {
      answerKey = await extractAnswerKeyFromPdf(answerBuffer);
    } else if (IMAGE_EXTS.has(answerExt)) {
      answerKey = await extractAnswerKeyFromImage(answerBuffer.toString("base64"), `image/${answerExt === "jpg" ? "jpeg" : answerExt}`);
    } else {
      return NextResponse.json({ error: "File đáp án chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
    }
    if (answerKey.length === 0) {
      warnings.push("Không đọc được đáp án nào từ file đáp án — giáo viên cần tự điền đáp án ở bước duyệt.");
    }
    extracted = { ...extracted, questions: mergeAnswerKeyIntoQuestions(extracted.questions, answerKey) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Lỗi xử lý file đáp án: ${message}` }, { status: 500 });
  }

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .insert({
      teacher_id: user.id,
      title: extracted.title,
      subject: extracted.subject,
      duration_minutes: durationMinutes,
      status: "reviewing",
      source_branch: extracted.source_branch,
    })
    .select()
    .single();

  if (examError || !exam) {
    return NextResponse.json({ error: examError?.message ?? "Không tạo được đề thi" }, { status: 500 });
  }

  for (let i = 0; i < extracted.questions.length; i++) {
    const q = extracted.questions[i];
    const imageUrls: string[] = [];

    for (const localName of q.image_urls) {
      if (!localImages?.has(localName)) continue;
      const imgBuffer = localImages.get(localName)!;
      const path = `${exam.id}/${crypto.randomUUID()}-${localName}`;
      const { error: uploadError } = await supabase.storage.from("exam-images").upload(path, imgBuffer, {
        contentType: `image/${localName.split(".").pop()}`,
      });
      if (!uploadError) {
        const { data: pub } = supabase.storage.from("exam-images").getPublicUrl(path);
        imageUrls.push(pub.publicUrl);
      }
    }

    await supabase.from("questions").insert({
      exam_id: exam.id,
      order_index: i,
      type: q.type,
      content_latex: q.content_latex,
      part_label: q.part_label,
      image_urls: imageUrls,
      options: q.options,
      sub_statements: q.sub_statements,
      correct_answer: q.correct_answer,
      short_answer_normalized: q.short_answer_normalized,
      score_rule: q.score_rule,
      max_score: q.max_score,
      raw_ocr_notes: q.raw_ocr_notes,
      needs_review: true,
    });
  }

  return NextResponse.json({ exam_id: exam.id, question_count: extracted.questions.length, warnings });
}
