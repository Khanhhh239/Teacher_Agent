import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Vercel Cron gọi endpoint này định kỳ (xem vercel.json) để giữ Supabase free-tier
 * project không bị tự pause sau 7 ngày không hoạt động.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  await supabase.from("exams").select("id").limit(1);

  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
