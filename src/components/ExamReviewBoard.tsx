"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { QuestionAnswerSplit, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import { QuestionExtras } from "@/components/QuestionExtras";
import type { Question, StudentAnswerPayload } from "@/types/exam";

/** Giao diện giáo viên duyệt đề: giống hệt bố cục học sinh làm bài (ảnh trái, phiếu trả lời
 * phải, thanh kéo giữa) nhưng đáp án đã có sẵn từ file đáp án và sửa được trực tiếp. */
export function ExamReviewBoard({ questions: initial }: { questions: Question[] }) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initial);

  function valueOf(q: Question): StudentAnswerPayload | null {
    if (q.type === "multiple_choice") return q.correct_answer ? { selected: q.correct_answer } : null;
    if (q.type === "true_false_group") {
      return { statements: Object.fromEntries(q.sub_statements.map((s) => [s.key, s.answer])) };
    }
    return q.short_answer_normalized ? { text: q.short_answer_normalized } : null;
  }

  async function handleChange(id: string, value: StudentAnswerPayload) {
    const q = questions.find((x) => x.id === id);
    if (!q) return;
    const patch: Partial<Question> = {
      needs_review: false,
      extraction_meta: q.extraction_meta ? { ...q.extraction_meta, blocking: false } : q.extraction_meta,
    };
    if (q.type === "multiple_choice") {
      patch.correct_answer = (value as { selected: string }).selected;
    } else if (q.type === "true_false_group") {
      const st = (value as { statements: Record<string, boolean> }).statements;
      patch.sub_statements = q.sub_statements.map((s) => ({ ...s, answer: st[s.key] ?? s.answer }));
    } else {
      patch.short_answer_normalized = (value as { text: string }).text;
    }
    const supabase = createClient();
    await supabase.from("questions").update(patch).eq("id", id);
    setQuestions((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    router.refresh();
  }

  async function replaceImage(id: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target", "crop");
    const res = await fetch(`/api/questions/${id}/replace-image`, { method: "POST", body: formData });
    const data = await res.json();
    if (data.source_crop_url) {
      setQuestions((prev) => prev.map((x) => (x.id === id ? { ...x, source_crop_url: data.source_crop_url } : x)));
    }
  }

  const splitQuestions: SplitQuestion[] = questions.map((q, idx) => ({
    id: q.id,
    number: idx + 1,
    part_label: q.part_label,
    source_crop_url: q.source_crop_url ?? null,
    type: q.type,
    optionKeys: q.options.map((o) => o.key),
    subKeys: q.sub_statements.map((s) => s.key),
  }));
  const values: Record<string, StudentAnswerPayload | null> = Object.fromEntries(questions.map((q) => [q.id, valueOf(q)]));

  return (
    <QuestionAnswerSplit
      questions={splitQuestions}
      values={values}
      onChange={handleChange}
      renderImageExtra={(sq) => {
        const full = questions.find((x) => x.id === sq.id);
        return <QuestionExtras meta={full?.extraction_meta} onReplaceImage={(file) => replaceImage(sq.id, file)} />;
      }}
    />
  );
}
