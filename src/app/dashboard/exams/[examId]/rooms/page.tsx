import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateRoomForm } from "@/components/CreateRoomForm";
import { RoomActiveToggle } from "@/components/RoomActiveToggle";
import type { Exam, ExamRoom } from "@/types/exam";

export default async function RoomsPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  const supabase = await createClient();

  const { data: exam } = await supabase.from("exams").select("*").eq("id", examId).single();
  if (!exam) notFound();

  const { data: rooms } = await supabase
    .from("exam_rooms")
    .select("*")
    .eq("exam_id", examId)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Phòng thi — {(exam as Exam).title}</h1>
      <p className="mb-4 text-sm text-slate-500">
        Học sinh vào thi tại <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/exam/join</code> bằng mã
        phòng bên dưới.
      </p>

      <div className="mb-5">
        <CreateRoomForm examId={examId} />
      </div>

      <div className="space-y-2.5">
        {(rooms as ExamRoom[] | null)?.map((room) => (
          <div key={room.id} className="card flex items-center justify-between p-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xl font-bold tracking-widest text-slate-900">{room.code}</p>
                <RoomActiveToggle roomId={room.id} isActive={room.is_active} />
              </div>
              <p className="text-xs text-slate-500">
                Tạo lúc {new Date(room.created_at).toLocaleString("vi-VN")}
                {room.opens_at || room.closes_at ? (
                  <>
                    {" "}
                    · Mở:{" "}
                    {room.opens_at ? new Date(room.opens_at).toLocaleString("vi-VN") : "ngay"} →{" "}
                    {room.closes_at ? new Date(room.closes_at).toLocaleString("vi-VN") : "không giới hạn"}
                  </>
                ) : (
                  " · Không giới hạn khung giờ vào thi"
                )}
              </p>
            </div>
            <Link
              href={`/dashboard/exams/${examId}/rooms/${room.id}`}
              className="shrink-0 text-sm font-medium text-indigo-600 hover:underline"
            >
              Xem kết quả →
            </Link>
          </div>
        ))}
        {!rooms?.length && (
          <div className="card border-dashed p-10 text-center">
            <p className="text-sm text-slate-500">Chưa có phòng thi nào.</p>
          </div>
        )}
      </div>
    </div>
  );
}
