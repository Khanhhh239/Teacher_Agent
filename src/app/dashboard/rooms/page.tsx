import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RoomActiveToggle } from "@/components/RoomActiveToggle";
import { RoomBankQuickCreate } from "@/components/RoomBankQuickCreate";
import type { Exam, ExamRoom } from "@/types/exam";

type RoomWithExam = ExamRoom & { exams: Pick<Exam, "id" | "title" | "status"> };

export default async function RoomBankPage() {
  const supabase = await createClient();

  const [{ data: rooms }, { data: exams }] = await Promise.all([
    supabase
      .from("exam_rooms")
      .select("*, exams(id, title, status)")
      .order("created_at", { ascending: false }),
    supabase.from("exams").select("*").eq("status", "ready").order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Kho phòng thi</h1>
      <p className="mb-4 text-sm text-slate-500">
        Toàn bộ phòng thi đã tạo, từ mọi đề thi. Học sinh vào thi tại{" "}
        <code className="rounded bg-slate-100 px-1">/exam/join</code> bằng mã phòng.
      </p>

      <div className="mb-5">
        <RoomBankQuickCreate readyExams={(exams as Exam[] | null) ?? []} />
      </div>

      <div className="space-y-2">
        {((rooms as RoomWithExam[] | null) ?? []).map((room) => (
          <div key={room.id} className="rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-lg font-bold tracking-widest">{room.code}</p>
                  <RoomActiveToggle roomId={room.id} isActive={room.is_active} />
                </div>
                <p className="truncate text-sm font-medium text-slate-700">{room.exams.title}</p>
                <p className="text-xs text-slate-500">
                  Tạo lúc {new Date(room.created_at).toLocaleString("vi-VN")}
                  {room.opens_at || room.closes_at ? (
                    <>
                      {" "}
                      · Mở: {room.opens_at ? new Date(room.opens_at).toLocaleString("vi-VN") : "ngay"} →{" "}
                      {room.closes_at ? new Date(room.closes_at).toLocaleString("vi-VN") : "không giới hạn"}
                    </>
                  ) : (
                    " · Không giới hạn khung giờ vào thi"
                  )}
                  {" · "}Tối đa {room.max_attempts} lượt/học sinh · Đuổi sau {room.violation_kick_limit} vi phạm
                </p>
              </div>
              <Link
                href={`/dashboard/exams/${room.exam_id}/rooms/${room.id}`}
                className="shrink-0 text-sm font-medium underline"
              >
                Xem kết quả →
              </Link>
            </div>
          </div>
        ))}
        {!rooms?.length && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
            Chưa có phòng thi nào.
          </p>
        )}
      </div>
    </div>
  );
}
