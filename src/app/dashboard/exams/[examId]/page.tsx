import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExamReviewBoard } from "@/components/ExamReviewBoard";
import { ExamStatusControls } from "@/components/ExamStatusControls";
import type { Exam, Question } from "@/types/exam";

export default async function ExamReviewPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const supabase = await createClient();

  const { data: exam } = await supabase.from("exams").select("*").eq("id", examId).single();
  if (!exam) notFound();

  const { data: questions } = await supabase
    .from("questions")
    .select("*")
    .eq("exam_id", examId)
    .order("order_index");

  const pendingReview = (questions as Question[] | null)?.filter((q) => q.needs_review).length ?? 0;
  const flaggedCount = (questions as Question[] | null)?.filter((q) => (q.extraction_meta?.flags.length ?? 0) > 0).length ?? 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{(exam as Exam).title}</h1>
          <p className="text-sm text-slate-500">
            {(exam as Exam).subject} · {(exam as Exam).duration_minutes} phút · {(questions as Question[] | null)?.length ?? 0} câu
            {flaggedCount > 0 && <span className="font-medium text-amber-600"> · {flaggedCount} câu có cờ cảnh báo, soát kỹ các câu này</span>}
            {(exam as Exam).original_file_url && (
              <>
                {" · "}
                <a href={(exam as Exam).original_file_url!} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                  Xem file PDF gốc
                </a>
              </>
            )}
          </p>
        </div>
        <ExamStatusControls exam={exam as Exam} questions={(questions as Question[] | null) ?? []} pendingReview={pendingReview} />
      </div>

      <div className="min-h-0 flex-1">
        <ExamReviewBoard questions={(questions as Question[] | null) ?? []} />
      </div>
    </div>
  );
}
