import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { data: question } = await supabase
    .from("questions")
    .select("id, exam_id, image_urls, source_crop_url, exams!inner(teacher_id)")
    .eq("id", questionId)
    .single();

  if (!question || (question.exams as unknown as { teacher_id: string }).teacher_id !== user.id) {
    return NextResponse.json({ error: "Không tìm thấy câu hỏi" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const index = Number(formData.get("index") ?? -1);
  // "crop" = thay ẢNH NỘI DUNG CHÍNH của câu (source_crop_url, dùng từ khi chuyển sang hiển thị
  // ảnh gốc thay vì LaTeX) — mặc định thay cái này nếu không truyền index hợp lệ cho image_urls.
  const target = String(formData.get("target") ?? (index >= 0 ? "image_urls" : "crop"));
  if (!file) {
    return NextResponse.json({ error: "Thiếu file ảnh" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${question.exam_id}/${crypto.randomUUID()}-teacher-upload.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from("exam-images").upload(path, buffer, {
    contentType: file.type || `image/${ext}`,
  });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }
  const { data: pub } = supabase.storage.from("exam-images").getPublicUrl(path);

  if (target === "crop") {
    await supabase.from("questions").update({ source_crop_url: pub.publicUrl }).eq("id", questionId);
    return NextResponse.json({ source_crop_url: pub.publicUrl });
  }

  const currentUrls: string[] = question.image_urls ?? [];
  const newUrls =
    index >= 0 && index < currentUrls.length
      ? currentUrls.map((u, i) => (i === index ? pub.publicUrl : u))
      : [...currentUrls, pub.publicUrl];

  await supabase.from("questions").update({ image_urls: newUrls }).eq("id", questionId);

  return NextResponse.json({ image_urls: newUrls });
}
