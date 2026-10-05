import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectDocxBranch, extractDocx } from "@/lib/extraction/docxExtract";
import {
  extractAnswerKeyFromText,
  extractAnswerKeyFromPdf,
  extractAnswerKeyFromImage,
} from "@/lib/extraction/llmClient";
import { buildImageQuestions, buildQuestionsFromAnswerKey } from "@/lib/extraction/imageQuestionPipeline";

export const runtime = "nodejs";
// Đọc file đáp án vẫn cần AI (có thể là lời giải nhiều trang); việc tạo câu hỏi từ file đề thì
// KHÔNG còn gọi AI nữa (xem imageQuestionPipeline.ts) nên nhanh hơn nhiều so với trước — vẫn
// giữ trần cao để an toàn với file đáp án dài.
export const maxDuration = 280;

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const ANSWER_DEADLINE = startedAt + 260_000;
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

  // Đề thi: CHỈ nhận PDF — nội dung câu hỏi giờ dùng thẳng ảnh cắt từ PDF (không còn chép lại
  // thành LaTeX), và việc phân đoạn từng câu dựa vào LỚP CHỮ của PDF (xem imageQuestionPipeline.ts),
  // nên cần đúng định dạng PDF xuất từ Word/trình soạn thảo (không phải ảnh quét/docx).
  if (ext !== "pdf") {
    await cleanupTmp();
    return NextResponse.json(
      { error: "File đề thi chỉ chấp nhận định dạng PDF (xuất từ Word: File → Save As → PDF). Nếu đang có file .docx, hãy chuyển sang PDF rồi upload lại." },
      { status: 400 }
    );
  }
  if (!IMAGE_EXTS.has(answerExt) && answerExt !== "pdf" && answerExt !== "docx") {
    await cleanupTmp();
    return NextResponse.json({ error: "File đáp án chỉ hỗ trợ .docx, .pdf hoặc ảnh (.jpg/.png)" }, { status: 400 });
  }

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

  // Docx đáp án dùng công thức MathType/Equation cũ (ảnh WMF) không đọc chính xác được —
  // từ chối ngay, yêu cầu chuyển sang PDF (xem lịch sử: CloudConvert dùng làm fallback trước
  // đây tốn kém/chậm/phụ thuộc bên thứ 3 và có lúc hết credit).
  const answerBranchPre = answerExt === "docx" ? await detectDocxBranch(answerBuffer) : null;
  if (answerBranchPre === "LEGACY_OLE_IMAGE") {
    await cleanupTmp();
    return NextResponse.json(
      {
        error:
          'File đáp án dùng công thức MathType/Equation cũ (ảnh WMF) mà hệ thống không đọc chính xác được. Vui lòng mở file trong Microsoft Word, chọn "Save As" → chọn định dạng PDF, rồi tải file PDF đó lên thay cho file .docx.',
      },
      { status: 400 }
    );
  }

  // 1) Phân đoạn + cắt ảnh từng câu từ PDF đề — nhánh chính hoàn toàn bằng code, không gọi AI.
  // Nếu PDF không có lớp chữ thật, tự động thử nhánh dự phòng (AI chỉ định vị toạ độ nhãn "Câu
  // N", không đọc nội dung — xem visionSegment.ts); chỉ báo lỗi nếu cả 2 nhánh đều thất bại.
  const warnings: string[] = [];
  // Cho nhánh PDF image-only đủ thời gian chạy 3 lượt voting/trang; vẫn nằm dưới
  // maxDuration=280s và chừa 20s cuối cho dọn dẹp + trả response.
  const EXAM_SEGMENT_DEADLINE = startedAt + 200_000;
  const imageResult = await buildImageQuestions(buffer, { warnings, deadline: EXAM_SEGMENT_DEADLINE });
  if (!imageResult.ok) {
    await cleanupTmp();
    return NextResponse.json(
      { error: `Không phân đoạn được đề thi: ${imageResult.reason}. Hệ thống cần file PDF có lớp chữ thật (xuất từ Word) hoặc định vị được nhãn "Câu 1.", "Câu 2."... liên tục.` },
      { status: 400 }
    );
  }
  const questionCount = imageResult.questions.length;

  // 2) Đọc file đáp án (vẫn cần AI — có thể là lời giải dài, ảnh chụp, hay bảng ngắn gọn).
  let answerKey;
  try {
    if (answerExt === "docx") {
      const result = await extractDocx(answerBuffer);
      answerKey = await extractAnswerKeyFromText(result.text, warnings);
    } else if (answerExt === "pdf") {
      answerKey = await extractAnswerKeyFromPdf(answerBuffer, warnings, { deadline: ANSWER_DEADLINE });
    } else {
      answerKey = await extractAnswerKeyFromImage(answerBuffer.toString("base64"), `image/${answerExt === "jpg" ? "jpeg" : answerExt}`, warnings);
    }
    if (answerKey.length === 0) {
      warnings.push("Không đọc được đáp án nào từ file đáp án — giáo viên cần tự điền đáp án ở bước duyệt.");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await cleanupTmp();
    return NextResponse.json({ error: `Lỗi xử lý file đáp án: ${message}` }, { status: 500 });
  }

  // 3) Ghép câu hỏi với đáp án — loại câu (trắc nghiệm/đúng-sai/điền ngắn) và đáp án đúng lấy
  // HOÀN TOÀN từ file đáp án, không cần AI đọc hiểu nội dung đề.
  const rows = buildQuestionsFromAnswerKey(
    questionCount,
    imageResult.questions.map((q) => q.part),
    answerKey
  );
  const blockingCount = rows.filter((r) => r.blocking).length;
  if (blockingCount > 0) {
    warnings.push(`${blockingCount} câu chưa có đáp án khớp trong file đáp án — giáo viên cần tự chọn loại câu và đáp án đúng cho các câu này ở bước duyệt.`);
  }
  if (imageResult.usedVision) {
    warnings.push("File đề không có lớp chữ thật nên hệ thống dùng AI để định vị ranh giới từng câu (không đọc nội dung) — soát kỹ từng ảnh câu hỏi ở bước duyệt, ranh giới cắt có thể hơi lệch.");
  }

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .insert({
      teacher_id: user.id,
      title: imageResult.title || "Đề thi chưa đặt tên",
      subject: "",
      duration_minutes: durationMinutes,
      status: "reviewing",
      source_branch: imageResult.usedVision ? "PDF_IMAGE_ONLY" : "PDF_TEXT_LAYER",
    })
    .select()
    .single();

  if (examError || !exam) {
    await cleanupTmp();
    return NextResponse.json({ error: examError?.message ?? "Không tạo được đề thi" }, { status: 500 });
  }

  // Lưu file PDF gốc để giáo viên xem lại (iframe render trực tiếp được vì input đã là PDF,
  // không cần convert gì thêm nữa) — không chặn cả lần upload nếu lỗi.
  try {
    const originalPath = `${exam.id}/original.pdf`;
    const { error: originalUploadError } = await supabase.storage
      .from("exam-images")
      .upload(originalPath, buffer, { contentType: "application/pdf" });
    if (!originalUploadError) {
      const { data: pub } = supabase.storage.from("exam-images").getPublicUrl(originalPath);
      await supabase.from("exams").update({ original_file_url: pub.publicUrl, original_file_ext: "pdf" }).eq("id", exam.id);
    }
  } catch {
    // không chặn upload chính nếu lưu file gốc thất bại
  }

  for (let i = 0; i < questionCount; i++) {
    const row = rows[i];
    const cropImage = imageResult.questions[i].image;

    let sourceCropUrl: string | null = null;
    try {
      const cropPath = `${exam.id}/src/q${i + 1}.png`;
      const { error: cropError } = await supabase.storage.from("exam-images").upload(cropPath, cropImage, { contentType: "image/png" });
      if (!cropError) sourceCropUrl = supabase.storage.from("exam-images").getPublicUrl(cropPath).data.publicUrl;
    } catch {
      // không có ảnh — câu này hiển thị trống, giáo viên cần thay ảnh thủ công ở bước duyệt
    }
    if (!sourceCropUrl) row.flags.push("Không lưu được ảnh câu hỏi — cần giáo viên tự chụp/thay ảnh ở bước duyệt.");

    const { error: insertError } = await supabase.from("questions").insert({
      exam_id: exam.id,
      order_index: i,
      type: row.type,
      content_latex: "",
      part_label: row.part_label,
      image_urls: [],
      source_crop_url: sourceCropUrl,
      options: row.options,
      sub_statements: row.sub_statements,
      correct_answer: row.correct_answer,
      short_answer_normalized: row.short_answer_normalized,
      score_rule: row.score_rule,
      max_score: row.max_score,
      raw_ocr_notes: null,
      needs_review: row.blocking,
      extraction_meta: { flags: row.flags, blocking: row.blocking, source: imageResult.usedVision ? "vision_label" : "text_layer" },
    });
    if (insertError) warnings.push(`Không lưu được câu ${i + 1}: ${insertError.message}`);
  }

  await cleanupTmp();
  return NextResponse.json({ exam_id: exam.id, question_count: questionCount, warnings });
}
