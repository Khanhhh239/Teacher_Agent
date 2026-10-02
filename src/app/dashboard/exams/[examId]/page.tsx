import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuestionEditor } from "@/components/QuestionEditor";
import { ExamStatusControls } from "@/components/ExamStatusControls";
import { ResizableSplitView } from "@/components/ResizableSplitView";
import { OriginalFileViewer } from "@/components/OriginalFileViewer";
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{(exam as Exam).title}</h1>
          <p className="text-sm text-slate-500">
            {(exam as Exam).subject} · {(exam as Exam).duration_minutes} phút ·{" "}
            {(questions as Question[] | null)?.length ?? 0} câu
          </p>
        </div>
        <ExamStatusControls
          exam={exam as Exam}
          questions={(questions as Question[] | null) ?? []}
          pendingReview={pendingReview}
        />
      </div>

      <ResizableSplitView
        left={
          <div className="space-y-3">
            {(questions as Question[] | null)?.map((q) => (
              <QuestionEditor key={q.id} question={q} />
            ))}
            {!questions?.length && (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
                Chưa có câu hỏi nào. Import từ pipeline hoặc thêm thủ công.
              </p>
            )}
          </div>
        }
        right={
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">
              Đề gốc — kéo thanh bên trái để thu/giãn khung này
            </p>
            <OriginalFileViewer
              url={(exam as Exam).original_file_url}
              ext={(exam as Exam).original_file_ext}
            />
          </div>
        }
      />
    </div>
  );
}
