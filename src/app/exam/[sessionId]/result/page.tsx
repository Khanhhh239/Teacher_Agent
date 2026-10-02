"use client";

import { use, useEffect, useState } from "react";
import { QuestionAnswerSplit, type Correctness, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import type { QuestionType, StudentAnswerPayload } from "@/types/exam";

interface ResultQuestion {
  id: string;
  type: QuestionType;
  part_label: string | null;
  source_crop_url: string | null;
  options: { key: string }[];
  sub_statements: { key: string; answer: boolean }[];
  max_score: number;
  correct_answer: string | null;
  short_answer_normalized: string | null;
  student_answer: StudentAnswerPayload | null;
  score: number;
}

export default function ResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [score, setScore] = useState<number | null>(null);
  const [questions, setQuestions] = useState<ResultQuestion[] | null>(null);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/submit`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        setScore(d.total_score);
        setQuestions(d.questions ?? []);
      });
  }, [sessionId]);

  const splitQuestions: SplitQuestion[] = (questions ?? []).map((q, idx) => ({
    id: q.id,
    number: idx + 1,
    part_label: q.part_label,
    source_crop_url: q.source_crop_url,
    type: q.type,
    optionKeys: q.options.map((o) => o.key),
    subKeys: q.sub_statements.map((s) => s.key),
  }));
  const values: Record<string, StudentAnswerPayload | null> = {};
  const correctness: Record<string, Correctness> = {};
  for (const q of questions ?? []) {
    values[q.id] = q.student_answer;
    correctness[q.id] = {
      correctAnswer: q.correct_answer,
      correctStatements: Object.fromEntries(q.sub_statements.map((s) => [s.key, s.answer])),
      correctText: q.short_answer_normalized,
    };
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <div className="shrink-0 border-b bg-white p-4 text-center">
        <h1 className="text-lg font-semibold">Đã nộp bài thành công</h1>
        {score !== null ? (
          <p>
            Điểm của bạn: <span className="text-2xl font-bold">{score}</span>
          </p>
        ) : (
          <p>Đang tính điểm...</p>
        )}
      </div>

      {questions && (
        <div className="min-h-0 flex-1 p-4">
          <QuestionAnswerSplit questions={splitQuestions} values={values} showCorrectness correctness={correctness} />
        </div>
      )}
    </div>
  );
}
