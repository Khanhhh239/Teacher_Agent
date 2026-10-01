import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectDocxBranch, extractDocx } from "@/lib/extraction/docxExtract";
import { structureExamText, extractPdfPages } from "@/lib/extraction/llmClient";
import { normalizeExtractedExam } from "@/lib/extraction/normalize";

export const runtime = "nodejs";
// Gemini đôi khi mất 30-90s để sinh JSON dài (đề 20+ câu), cộng thêm tối đa 3 lần retry
// khi gặp lỗi 503 quá tải (xem llmClient.ts) — đặt cao để giảm khả năng timeout giữa
// chừng. Vercel Hobby cho phép cấu hình tới 300s cho Node runtime function.
export const maxDuration = 180;

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
  const durationMinutes = Number(formData.get("duration_minutes") ?? 90);
  if (!file) {
    return NextResponse.json({ error: "Thiếu file" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

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
    } else {
      return NextResponse.json({ error: "Chỉ hỗ trợ file .docx hoặc .pdf" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Lỗi xử lý file: ${message}` }, { status: 500 });
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
