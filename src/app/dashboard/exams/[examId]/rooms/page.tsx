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
      <h1 className="mb-1 text-lg font-semibold">Phòng thi — {(exam as Exam).title}</h1>
      <p className="mb-4 text-sm text-slate-500">
        Học sinh vào thi tại <code className="rounded bg-slate-100 px-1">/exam/join</code> bằng mã
        phòng bên dưới.
      </p>

      <div className="mb-4">
        <CreateRoomForm examId={examId} />
      </div>

      <div className="space-y-2">
        {(rooms as ExamRoom[] | null)?.map((room) => (
          <div key={room.id} className="flex items-center justify-between rounded-lg border bg-white p-4">
            <div>
              <p className="font-mono text-xl font-bold tracking-widest">{room.code}</p>
              <p className="text-xs text-slate-500">
                Tạo lúc {new Date(room.created_at).toLocaleString("vi-VN")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <RoomActiveToggle roomId={room.id} isActive={room.is_active} />
              <Link
                href={`/dashboard/exams/${examId}/rooms/${room.id}`}
                className="text-sm font-medium underline"
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
