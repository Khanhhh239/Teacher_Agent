import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { seededShuffle, seededShuffleByGroup, seedFromString } from "@/lib/shuffle";
import type { Question } from "@/types/exam";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { student_name, student_code } = await request.json();

  if (!student_name || typeof student_name !== "string") {
    return NextResponse.json({ error: "Thiếu tên học sinh" }, { status: 400 });
  }
  if (!student_code || typeof student_code !== "string" || !student_code.trim()) {
    return NextResponse.json({ error: "Thiếu số báo danh — đây là trường bắt buộc" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: room, error: roomError } = await supabase
    .from("exam_rooms")
    .select("*, exams(*)")
    .eq("code", code.toUpperCase())
    .single();

  if (roomError || !room) {
    return NextResponse.json({ error: "Không tìm thấy phòng thi" }, { status: 404 });
  }
  if (!room.is_active) {
    return NextResponse.json({ error: "Phòng thi đã đóng" }, { status: 403 });
  }
  const now = new Date();
  if (room.opens_at && now < new Date(room.opens_at)) {
    return NextResponse.json({ error: "Chưa đến giờ thi" }, { status: 403 });
  }
  if (room.closes_at && now > new Date(room.closes_at)) {
    return NextResponse.json({ error: "Đã hết thời gian vào thi" }, { status: 403 });
  }

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("exam_id", room.exam_id)
    .order("order_index");

  if (!questions?.length) {
    return NextResponse.json({ error: "Đề thi chưa có câu hỏi" }, { status: 400 });
  }

  // Giới hạn số lần một học sinh được vào thi lại cùng 1 phòng — nhận diện học sinh qua
  // SBD nếu có, không thì qua tên (vì SBD là tùy chọn). Đếm MỌI phiên trước đó bất kể
  // trạng thái (kể cả đang làm dở), vì mỗi lần join là 1 lượt thi mới.
  const trimmedCode = (student_code || "").trim();
  let priorAttemptsQuery = supabase
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id);
  priorAttemptsQuery = trimmedCode
    ? priorAttemptsQuery.eq("student_code", trimmedCode)
    : priorAttemptsQuery.eq("student_name", student_name.trim());
  const { count: priorAttempts } = await priorAttemptsQuery;
  const maxAttempts = room.max_attempts ?? 1;
  if ((priorAttempts ?? 0) >= maxAttempts) {
    return NextResponse.json(
      { error: `Bạn đã dùng hết số lần làm bài cho phép (${maxAttempts} lần).` },
      { status: 403 }
    );
  }

  const { data: session, error: sessionError } = await supabase
    .from("exam_sessions")
    .insert({
      room_id: room.id,
      student_name,
      student_code: student_code ?? "",
      question_order: [],
      option_order: {},
    })
    .select()
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Không thể tạo phiên thi" }, { status: 500 });
  }

  const settings = room.exams.settings ?? {};
  const shuffleQuestions = settings.shuffle_questions ?? true;
  const shuffleOptions = settings.shuffle_options ?? true;

  const baseSeed = seedFromString(session.id);
  // Giữ nguyên thứ tự các PHẦN (I/II/III...) của đề — chỉ xáo câu hỏi TRONG từng phần,
  // không xáo lẫn qua phần khác (đúng cấu trúc đề thi gốc).
  const questionOrder = shuffleQuestions
    ? seededShuffleByGroup(questions as Question[], baseSeed, (q) => q.part_label ?? "").map((q) => q.id)
    : questions.map((q: Question) => q.id);

  const optionOrder: Record<string, string[]> = {};
  for (const q of questions as Question[]) {
    if (q.type === "multiple_choice") {
      const keys = q.options.map((o) => o.key);
      optionOrder[q.id] = shuffleOptions
        ? seededShuffle(keys, seedFromString(session.id + q.id))
        : keys;
    }
  }

  await supabase
    .from("exam_sessions")
    .update({ question_order: questionOrder, option_order: optionOrder })
    .eq("id", session.id);

  return NextResponse.json({
    session_id: session.id,
    exam_title: room.exams.title,
    duration_minutes: room.exams.duration_minutes,
    require_fullscreen: room.require_fullscreen,
  });
}
