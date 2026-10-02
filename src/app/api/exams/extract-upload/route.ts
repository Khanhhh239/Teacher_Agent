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
  const filePathRaw: string | undefined = body.file_path;
  const fileNameRaw: string | undefined = body.file_name;
  const answerFilePathRaw: string | undefined = body.answer_file_path;
  const answerFileNameRaw: string | undefined = body.answer_file_name;
  const durationMinutes = Number(body.duration_minutes ?? 90);
  if (!filePathRaw || !fileNameRaw) {
    return NextResponse.json({ error: "Thiếu file đề thi" }, { status: 400 });
  }
  if (!answerFilePathRaw || !answerFileNameRaw) {
    return NextResponse.json({ error: "Thiếu file đáp án — cần upload cả đề và đáp án" }, { status: 400 });
  }
  // Gán lại sang biến `string` thường (không phải `string | undefined`) sau khi đã kiểm tra
  // ở trên — TS không giữ được narrowing của biến ngoài khi dùng trong closure khai báo bên
  // dưới (processExamFile/processAnswerKeyFile), nên cần tách biến tường minh thế này.
  const filePath: string = filePathRaw;
  const fileName: string = fileNameRaw;
  const answerFilePath: string = answerFilePathRaw;
  const answerFileName: string = answerFileNameRaw;

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

  const warnings: string[] = [];

  if (!IMAGE_EXTS.has(ext) && ext !== "pdf" && ext !== "docx") {
    await cleanupTmp();
    return NextResponse.json({ error: "File đề thi chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
  }
  if (!IMAGE_EXTS.has(answerExt) && answerExt !== "pdf" && answerExt !== "docx") {
    await cleanupTmp();
    return NextResponse.json({ error: "File đáp án chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
  }

  // Docx dùng công thức MathType/Equation cũ (ảnh WMF nhúng, không phải XML toán học) không
  // đọc được chính xác và trước đây phải fallback qua CloudConvert (dịch vụ trả phí, có lúc
  // hết credit — xem lịch sử) để convert sang PDF rồi mới đọc được. Thay vì fallback tốn
  // kém/chậm/phụ thuộc bên thứ 3, từ chối thẳng ngay lúc upload và yêu cầu giáo viên tự
  // convert sang PDF trong Word (Word render công thức chính xác hơn bất kỳ cách nào khác) —
  // docx hiện đại (công thức Word gốc hoặc không có công thức) vẫn được xử lý bình thường,
  // nhanh và chính xác 100% vì không cần qua Gemini vision.
  const MATHTYPE_REJECT_MESSAGE = (which: string) =>
    `${which} dùng công thức MathType/Equation cũ (ảnh WMF) mà hệ thống không đọc chính xác được. Vui lòng mở file trong Microsoft Word, chọn "Save As" (Lưu dưới dạng khác) → chọn định dạng PDF, rồi tải file PDF đó lên thay cho file .docx.`;
  const [fileBranchPre, answerBranchPre] = await Promise.all([
    ext === "docx" ? detectDocxBranch(buffer) : null,
    answerExt === "docx" ? detectDocxBranch(answerBuffer) : null,
  ]);
  if (fileBranchPre === "LEGACY_OLE_IMAGE" && answerBranchPre === "LEGACY_OLE_IMAGE") {
    await cleanupTmp();
    return NextResponse.json({ error: MATHTYPE_REJECT_MESSAGE("File đề thi và file đáp án đều") }, { status: 400 });
  }
  if (fileBranchPre === "LEGACY_OLE_IMAGE") {
    await cleanupTmp();
    return NextResponse.json({ error: MATHTYPE_REJECT_MESSAGE("File đề thi") }, { status: 400 });
  }
  if (answerBranchPre === "LEGACY_OLE_IMAGE") {
    await cleanupTmp();
    return NextResponse.json({ error: MATHTYPE_REJECT_MESSAGE("File đáp án") }, { status: 400 });
  }

  /**
   * Xử lý file đề và file đáp án ĐỘC LẬP, chạy SONG SONG bằng Promise.all thay vì tuần tự
   * — trước đây xử lý nối tiếp 2 file (đề xong mới tới đáp án) có lúc cộng dồn tới >190s cho
   * 1 đề 22 câu có công thức MathType cũ, sát ngưỡng maxDuration=280s; khi Gemini chậm hơn
   * bình thường (quan sát thực tế: lỗi RECITATION phải retry) tổng thời gian có thể VƯỢT
   * maxDuration, khiến Vercel tự cắt request và trả về trang lỗi HTML (không phải JSON) —
   * đây chính là nguồn gốc lỗi "Unexpected token... is not valid JSON" khi xử lý quá lâu
   * (khác với lỗi JSON do vượt body size đã sửa trước đó). Chạy song song giúp tổng thời
   * gian gần bằng thời gian của file CHẬM HƠN thay vì tổng cả 2, giảm đáng kể rủi ro timeout.
   */
  async function processExamFile(): Promise<{
    extracted: ReturnType<typeof normalizeExtractedExam>;
    localImages: Map<string, Buffer> | null;
    previewPdfBuffer: Buffer | null;
  }> {
    let extracted: ReturnType<typeof normalizeExtractedExam>;
    let localImages: Map<string, Buffer> | null = null;
    let previewPdfBuffer: Buffer | null = null;

    try {
      if (ext === "docx") {
        // fileBranchPre chỉ có thể là OMML_NATIVE/NO_MATH_DETECTED ở đây — LEGACY_OLE_IMAGE
        // đã bị từ chối sớm ở trên trước khi vào hàm này.
        const result = await extractDocx(buffer);
        localImages = result.images;
        warnings.push(...result.warnings);
        const structured = await structureExamText(result.text, warnings);
        extracted = normalizeExtractedExam({ ...structured, source_branch: fileBranchPre ?? "NO_MATH_DETECTED" });
        // Convert thêm 1 lần CHỈ để làm file xem trước đối chiếu bên phải màn hình duyệt đề
        // (không ảnh hưởng độ chính xác trích xuất) — không chặn cả lần upload nếu lỗi.
        try {
          previewPdfBuffer = await convertToPdf(buffer, fileName);
        } catch {
          // không có bản xem trước PDF — OriginalFileViewer sẽ chỉ hiện link tải file .docx
        }
      } else if (ext === "pdf") {
        const { extracted: pdfExtracted, images } = await extractPdfPages(buffer, warnings);
        localImages = images;
        extracted = normalizeExtractedExam({ ...pdfExtracted, source_branch: "PDF_IMAGE_ONLY" });
      } else {
        const { extracted: imgExtracted, images } = await extractExamFromImage(buffer, warnings);
        localImages = images;
        extracted = normalizeExtractedExam({ ...imgExtracted, source_branch: "PDF_IMAGE_ONLY" });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Lỗi xử lý file đề thi: ${message}`);
    }

    return { extracted, localImages, previewPdfBuffer };
  }

  async function processAnswerKeyFile() {
    try {
      let answerKey;
      if (answerExt === "docx") {
        // answerBranchPre chỉ có thể là OMML_NATIVE/NO_MATH_DETECTED ở đây — LEGACY_OLE_IMAGE
        // đã bị từ chối sớm ở trên trước khi vào hàm này.
        const result = await extractDocx(answerBuffer);
        answerKey = await extractAnswerKeyFromText(result.text, warnings);
      } else if (answerExt === "pdf") {
        answerKey = await extractAnswerKeyFromPdf(answerBuffer, warnings);
      } else {
        answerKey = await extractAnswerKeyFromImage(answerBuffer.toString("base64"), `image/${answerExt === "jpg" ? "jpeg" : answerExt}`, warnings);
      }
      if (answerKey.length === 0) {
        warnings.push("Không đọc được đáp án nào từ file đáp án — giáo viên cần tự điền đáp án ở bước duyệt.");
      }
      return answerKey;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Lỗi xử lý file đáp án: ${message}`);
    }
  }

  let examResult: Awaited<ReturnType<typeof processExamFile>>;
  let answerKey: Awaited<ReturnType<typeof processAnswerKeyFile>>;
  try {
    [examResult, answerKey] = await Promise.all([processExamFile(), processAnswerKeyFile()]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await cleanupTmp();
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { localImages, previewPdfBuffer } = examResult;
  const extracted = { ...examResult.extracted, questions: mergeAnswerKeyIntoQuestions(examResult.extracted.questions, answerKey) };

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
