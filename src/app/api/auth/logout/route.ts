import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // status 303 bắt buộc trình duyệt chuyển request kế tiếp thành GET — mặc định
  // NextResponse.redirect() từ handler POST dùng 307 (giữ nguyên method), khiến trình
  // duyệt POST thẳng vào /login (page chỉ nhận GET) và bị lỗi 405.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
