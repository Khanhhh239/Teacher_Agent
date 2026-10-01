import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { type, meta } = await request.json();

  const supabase = createAdminClient();

  await supabase.from("exam_violations").insert({
    session_id: sessionId,
    type,
    meta: meta ?? {},
  });

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("violation_count, status, room_id, exam_rooms(violation_kick_limit)")
    .eq("id", sessionId)
    .single();

  const newCount = (session?.violation_count ?? 0) + 1;
  const kickLimit = (session?.exam_rooms as unknown as { violation_kick_limit: number } | null)?.violation_kick_limit ?? 1;
  const shouldKick = session?.status === "in_progress" && newCount >= kickLimit;

  await supabase
    .from("exam_sessions")
    .update({
      violation_count: newCount,
      ...(shouldKick ? { status: "submitted", kicked_at: new Date().toISOString() } : {}),
    })
    .eq("id", sessionId);

  return NextResponse.json({ ok: true, kicked: shouldKick });
}
