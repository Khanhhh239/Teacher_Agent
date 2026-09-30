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
    .select("violation_count")
    .eq("id", sessionId)
    .single();

  await supabase
    .from("exam_sessions")
    .update({ violation_count: (session?.violation_count ?? 0) + 1 })
    .eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
