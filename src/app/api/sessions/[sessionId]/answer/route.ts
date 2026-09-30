import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { question_id, answer } = await request.json();

  if (!question_id || !answer) {
    return NextResponse.json({ error: "Thiếu dữ liệu" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("status")
    .eq("id", sessionId)
    .single();

  if (!session || session.status !== "in_progress") {
    return NextResponse.json({ error: "Phiên thi đã kết thúc" }, { status: 403 });
  }

  const { error } = await supabase.from("student_answers").upsert(
    {
      session_id: sessionId,
      question_id,
      answer,
    },
    { onConflict: "session_id,question_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
