import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { seededShuffle, seedFromString } from "@/lib/shuffle";
import type { Question } from "@/types/exam";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { student_name, student_code } = await request.json();

  if (!student_name || typeof student_name !== "string") {
    return NextResponse.json({ error: "Thiếu tên học sinh" }, { status: 400 });
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
  const questionOrder = shuffleQuestions
    ? seededShuffle(
        questions.map((q: Question) => q.id),
        baseSeed
      )
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
