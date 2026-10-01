"use client";

import { use, useEffect, useState } from "react";
import { LatexText } from "@/components/Latex";
import type { StudentAnswerPayload } from "@/types/exam";

interface ResultQuestion {
  id: string;
  type: "multiple_choice" | "true_false_group" | "short_answer";
  content_latex: string;
  part_label: string | null;
  image_urls: string[];
  options: { key: string; text_latex: string }[];
  sub_statements: { key: string; text_latex: string; answer: boolean }[];
  max_score: number;
  correct_answer: string | null;
  short_answer_normalized: string | null;
  student_answer: StudentAnswerPayload | null;
  is_correct: boolean | null;
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

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-6 text-center">
          <h1 className="text-xl font-semibold">Đã nộp bài thành công</h1>
          {score !== null ? (
            <p className="text-lg">
              Điểm của bạn: <span className="text-3xl font-bold">{score}</span>
            </p>
          ) : (
            <p>Đang tính điểm...</p>
          )}
        </div>

        {questions?.map((q, idx) => {
          const prevPart = idx > 0 ? questions[idx - 1].part_label : null;
          const showPartHeader = q.part_label && q.part_label !== prevPart;
          return (
            <div key={q.id}>
              {showPartHeader && <h2 className="mb-2 mt-2 font-bold">{q.part_label}</h2>}
              <div
                className={`rounded-lg border bg-white p-4 ${
                  q.score >= q.max_score ? "border-green-300" : "border-red-300"
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p>
                    <span className="font-bold">Câu {idx + 1}.</span> <LatexText text={q.content_latex} />
                  </p>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                      q.score >= q.max_score
                        ? "bg-green-100 text-green-700"
                        : q.score > 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {q.score}/{q.max_score}đ
                  </span>
                </div>

                {q.image_urls.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {q.image_urls.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" className="max-h-72 rounded border" />
                    ))}
                  </div>
                )}

                {q.type === "multiple_choice" && (
                  <div className="space-y-2">
                    {q.options.map((o) => {
                      const selected = (q.student_answer as { selected: string } | null)?.selected === o.key;
                      const isCorrectOption = o.key === q.correct_answer;
                      return (
                        <div
                          key={o.key}
                          className={`rounded-md border p-2 text-sm ${
                            isCorrectOption
                              ? "border-green-400 bg-green-50"
                              : selected
                                ? "border-red-400 bg-red-50"
                                : ""
                          }`}
                        >
                          <span className="font-medium">{o.key}.</span> <LatexText text={o.text_latex} />
                          {isCorrectOption && <span className="ml-2 text-xs text-green-700">(đáp án đúng)</span>}
                          {selected && !isCorrectOption && <span className="ml-2 text-xs text-red-700">(bạn chọn)</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {q.type === "true_false_group" && (
                  <div className="space-y-2">
                    {q.sub_statements.map((s) => {
                      const studentVal = (q.student_answer as { statements: Record<string, boolean> } | null)
                        ?.statements?.[s.key];
                      const correct = studentVal === s.answer;
                      return (
                        <div
                          key={s.key}
                          className={`flex items-center justify-between rounded-md border p-2 text-sm ${
                            correct ? "border-green-400 bg-green-50" : "border-red-400 bg-red-50"
                          }`}
                        >
                          <span>
                            {s.key}) <LatexText text={s.text_latex} />
                          </span>
                          <span className="shrink-0 text-xs">
                            Bạn chọn: {studentVal === undefined ? "—" : studentVal ? "Đúng" : "Sai"} · Đáp án:{" "}
                            {s.answer ? "Đúng" : "Sai"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {q.type === "short_answer" && (
                  <div className="space-y-2 text-sm">
                    <p>
                      Bạn trả lời:{" "}
                      <span className={q.score >= q.max_score ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
                        {(q.student_answer as { text: string } | null)?.text || "(bỏ trống)"}
                      </span>
                    </p>
                    {q.score < q.max_score && (
                      <p>
                        Đáp án đúng: <span className="font-semibold text-green-700">{q.short_answer_normalized}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <p className="text-center text-sm text-slate-500">Bạn có thể đóng cửa sổ này.</p>
      </div>
    </div>
  );
}
