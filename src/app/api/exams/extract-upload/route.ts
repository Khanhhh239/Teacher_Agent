import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
import { convertToPdf } from "@/lib/conversion/cloudconvert";

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

  // Nhận đường dẫn Storage (file đã được trình duyệt upload thẳng lên Supabase Storage,
  // bỏ qua giới hạn ~4.5MB request body của Vercel Hobby) thay vì nhận bytes file trực
  // tiếp qua formData — xem src/app/dashboard/exams/new/page.tsx.
  const body = await request.json();
  const filePath: string | undefined = body.file_path;
  const fileName: string | undefined = body.file_name;
  const answerFilePath: string | undefined = body.answer_file_path;
  const answerFileName: string | undefined = body.answer_file_name;
  const durationMinutes = Number(body.duration_minutes ?? 90);
  if (!filePath || !fileName) {
    return NextResponse.json({ error: "Thiếu file đề thi" }, { status: 400 });
  }
  if (!answerFilePath || !answerFileName) {
    return NextResponse.json({ error: "Thiếu file đáp án — cần upload cả đề và đáp án" }, { status: 400 });
  }

  const admin = createAdminClient();
  const tmpPaths = [filePath, answerFilePath];
  async function cleanupTmp() {
    await admin.storage.from("exam-images").remove(tmpPaths).catch(() => {});
  }

  const ext = extOf(fileName);
  const answerExt = extOf(answerFileName);
  let buffer: Buffer;
  let answerBuffer: Buffer;
  try {
    const [fileDownload, answerDownload] = await Promise.all([
      admin.storage.from("exam-images").download(filePath),
      admin.storage.from("exam-images").download(answerFilePath),
    ]);
    if (fileDownload.error || !fileDownload.data) {
      throw new Error(fileDownload.error?.message ?? "không tải được file đề thi từ storage");
    }
    if (answerDownload.error || !answerDownload.data) {
      throw new Error(answerDownload.error?.message ?? "không tải được file đáp án từ storage");
    }
    buffer = Buffer.from(await fileDownload.data.arrayBuffer());
    answerBuffer = Buffer.from(await answerDownload.data.arrayBuffer());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await cleanupTmp();
    return NextResponse.json({ error: `Lỗi tải file đã upload: ${message}` }, { status: 500 });
  }

  let extracted;
  let sourceBranch: string;
  let localImages: Map<string, Buffer> | null = null;
  const warnings: string[] = [];
  // Giữ lại bản PDF đã convert (nếu có) để dùng làm file xem trước đối chiếu bên phải màn
  // hình duyệt đề — xem khối "Lưu lại file đề gốc" bên dưới và OriginalFileViewer.tsx.
  let previewPdfBuffer: Buffer | null = null;

  try {
    if (ext === "docx") {
      sourceBranch = await detectDocxBranch(buffer);
      if (sourceBranch === "LEGACY_OLE_IMAGE") {
        // Công thức MathType/WMF cũ — 2 cách tự giải mã WMF trực tiếp trong Node đều thất
        // bại trên Vercel (binary native lỗi, rồi thiếu font khi render SVG). Thay vào đó
        // convert cả file sang PDF qua CloudConvert (chạy LibreOffice thật trên server họ,
        // render công thức đúng như Word hiển thị), rồi đi qua pipeline PDF đã kiểm chứng.
        try {
          const pdfBuffer = await convertToPdf(buffer, fileName);
          previewPdfBuffer = pdfBuffer;
          const { extracted: pdfExtracted, images } = await extractPdfPages(pdfBuffer, warnings);
          localImages = images;
          extracted = normalizeExtractedExam({ ...pdfExtracted, source_branch: "PDF_IMAGE_ONLY" });
          sourceBranch = "PDF_IMAGE_ONLY";
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          warnings.push(`Không convert được sang PDF để đọc công thức MathType cũ (${message}) — dùng lại cách cũ, các công thức sẽ đánh dấu [CT?N] cần giáo viên tự nhập.`);
          const result = await extractDocx(buffer);
          localImages = result.images;
          warnings.push(...result.warnings);
          const structured = await structureExamText(result.text, warnings);
          extracted = normalizeExtractedExam({ ...structured, source_branch: sourceBranch });
        }
      } else {
        const result = await extractDocx(buffer);
        localImages = result.images;
        warnings.push(...result.warnings);
        const structured = await structureExamText(result.text, warnings);
        extracted = normalizeExtractedExam({ ...structured, source_branch: sourceBranch });
      }
      if (!previewPdfBuffer) {
        // Chưa có bản PDF nào (nhánh OMML_NATIVE/NO_MATH_DETECTED không cần convert để đọc
        // nội dung) — convert thêm 1 lần CHỈ để làm file xem trước đối chiếu, không chặn cả
        // lần upload nếu lỗi (giáo viên vẫn tải file .docx gốc về xem được như trước).
        try {
          previewPdfBuffer = await convertToPdf(buffer, fileName);
        } catch {
          // không có bản xem trước PDF — OriginalFileViewer sẽ chỉ hiện link tải file .docx
        }
      }
    } else if (ext === "pdf") {
      sourceBranch = "PDF_IMAGE_ONLY";
      const { extracted: pdfExtracted, images } = await extractPdfPages(buffer, warnings);
      localImages = images;
      extracted = normalizeExtractedExam({ ...pdfExtracted, source_branch: sourceBranch });
    } else if (IMAGE_EXTS.has(ext)) {
      sourceBranch = "PDF_IMAGE_ONLY";
      const { extracted: imgExtracted, images } = await extractExamFromImage(buffer, warnings);
      localImages = images;
      extracted = normalizeExtractedExam({ ...imgExtracted, source_branch: sourceBranch });
    } else {
      await cleanupTmp();
      return NextResponse.json({ error: "File đề thi chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await cleanupTmp();
    return NextResponse.json({ error: `Lỗi xử lý file đề thi: ${message}` }, { status: 500 });
  }

  try {
    let answerKey;
    if (answerExt === "docx") {
      const answerBranch = await detectDocxBranch(answerBuffer);
      if (answerBranch === "LEGACY_OLE_IMAGE") {
        try {
          const pdfBuffer = await convertToPdf(answerBuffer, answerFileName);
          answerKey = await extractAnswerKeyFromPdf(pdfBuffer, warnings);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          warnings.push(`Không convert được file đáp án sang PDF (${message}) — thử đọc trực tiếp, có thể thiếu công thức.`);
          const result = await extractDocx(answerBuffer);
          answerKey = await extractAnswerKeyFromText(result.text, warnings);
        }
      } else {
        const result = await extractDocx(answerBuffer);
        answerKey = await extractAnswerKeyFromText(result.text, warnings);
      }
    } else if (answerExt === "pdf") {
      answerKey = await extractAnswerKeyFromPdf(answerBuffer, warnings);
    } else if (IMAGE_EXTS.has(answerExt)) {
      answerKey = await extractAnswerKeyFromImage(answerBuffer.toString("base64"), `image/${answerExt === "jpg" ? "jpeg" : answerExt}`, warnings);
    } else {
      await cleanupTmp();
      return NextResponse.json({ error: "File đáp án chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
    }
    if (answerKey.length === 0) {
      warnings.push("Không đọc được đáp án nào từ file đáp án — giáo viên cần tự điền đáp án ở bước duyệt.");
    }
    extracted = { ...extracted, questions: mergeAnswerKeyIntoQuestions(extracted.questions, answerKey) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await cleanupTmp();
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
    await cleanupTmp();
    return NextResponse.json({ error: examError?.message ?? "Không tạo được đề thi" }, { status: 500 });
  }

  // Lưu lại file đề gốc để giáo viên đối chiếu song song với đề đã trích xuất lúc duyệt
  // (xem src/app/dashboard/exams/[examId]/page.tsx) — không chặn cả lần upload nếu lỗi.
  try {
    const originalPath = `${exam.id}/original.${ext}`;
    const contentType =
      ext === "pdf"
        ? "application/pdf"
        : ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : `image/${ext === "jpg" ? "jpeg" : ext}`;
    const { error: originalUploadError } = await supabase.storage
      .from("exam-images")
      .upload(originalPath, buffer, { contentType });
    const examUpdate: Record<string, string> = {};
    if (!originalUploadError) {
      const { data: pub } = supabase.storage.from("exam-images").getPublicUrl(originalPath);
      examUpdate.original_file_url = pub.publicUrl;
      examUpdate.original_file_ext = ext;
    }
    if (previewPdfBuffer) {
      const previewPath = `${exam.id}/original_preview.pdf`;
      const { error: previewUploadError } = await supabase.storage
        .from("exam-images")
        .upload(previewPath, previewPdfBuffer, { contentType: "application/pdf" });
      if (!previewUploadError) {
        const { data: previewPub } = supabase.storage.from("exam-images").getPublicUrl(previewPath);
        examUpdate.original_preview_url = previewPub.publicUrl;
      }
    }
    if (Object.keys(examUpdate).length > 0) {
      await supabase.from("exams").update(examUpdate).eq("id", exam.id);
    }
  } catch {
    // không chặn upload chính nếu lưu file gốc/bản xem trước thất bại
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

  await cleanupTmp();
  return NextResponse.json({ exam_id: exam.id, question_count: extracted.questions.length, warnings });
}
