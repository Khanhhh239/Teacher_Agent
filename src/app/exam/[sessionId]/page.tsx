"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LatexText } from "@/components/Latex";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import type { StudentAnswerPayload } from "@/types/exam";

interface ExamQuestion {
  id: string;
  type: "multiple_choice" | "true_false_group" | "short_answer";
  content_latex: string;
  image_url: string | null;
  options: { key: string; text_latex: string }[];
  sub_statements: { key: string; text_latex: string }[];
  max_score: number;
}

interface SessionData {
  session_id: string;
  status: string;
  exam_title: string;
  require_fullscreen: boolean;
  remaining_seconds: number;
  questions: ExamQuestion[];
  existing_answers: { question_id: string; answer: StudentAnswerPayload }[];
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function TakeExamPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<SessionData | null>(null);
  const [answers, setAnswers] = useState<Record<string, StudentAnswerPayload>>({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d: SessionData) => {
        setData(d);
        setRemaining(d.remaining_seconds);
        const initial: Record<string, StudentAnswerPayload> = {};
        for (const a of d.existing_answers) initial[a.question_id] = a.answer;
        setAnswers(initial);
      });
  }, [sessionId]);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await fetch(`/api/sessions/${sessionId}/submit`, { method: "POST" });
    router.push(`/exam/${sessionId}/result`);
  }, [sessionId, router]);

  useEffect(() => {
    if (!data) return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          submit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [data, submit]);

  useAntiCheat(sessionId, !!data && data.status === "in_progress", data?.require_fullscreen ?? false);

  function saveAnswer(questionId: string, answer: StudentAnswerPayload) {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    fetch(`/api/sessions/${sessionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, answer }),
    }).catch(() => {});
  }

  if (!data) {
    return <div className="flex min-h-screen items-center justify-center">Đang tải đề thi...</div>;
  }

  if (data.status !== "in_progress") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Bài thi này đã được nộp trước đó.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3 shadow-sm">
        <h1 className="font-semibold">{data.exam_title}</h1>
        <span
          className={`rounded-md px-3 py-1 font-mono text-lg font-bold ${
            remaining < 300 ? "bg-red-100 text-red-700" : "bg-slate-100"
          }`}
        >
          {formatTime(remaining)}
        </span>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {data.questions.map((q, idx) => (
          <div key={q.id} className="rounded-lg border bg-white p-4">
            <p className="mb-3 font-medium">
              Câu {idx + 1}. <LatexText text={q.content_latex} />
            </p>
            {q.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.image_url} alt="" className="mb-3 max-h-72 rounded border" />
            )}

            {q.type === "multiple_choice" && (
              <div className="space-y-2">
                {q.options.map((o) => (
                  <label
                    key={o.key}
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={(answers[q.id] as { selected: string } | undefined)?.selected === o.key}
                      onChange={() => saveAnswer(q.id, { selected: o.key })}
                    />
                    <span className="font-medium">{o.key}.</span> <LatexText text={o.text_latex} />
                  </label>
                ))}
              </div>
            )}

            {q.type === "true_false_group" && (
              <div className="space-y-2">
                {q.sub_statements.map((s) => {
                  const current = (answers[q.id] as { statements: Record<string, boolean> } | undefined)
                    ?.statements ?? {};
                  return (
                    <div key={s.key} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span>
                        {s.key}) <LatexText text={s.text_latex} />
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            saveAnswer(q.id, { statements: { ...current, [s.key]: true } })
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            current[s.key] === true ? "bg-green-600 text-white" : "bg-slate-100"
                          }`}
                        >
                          Đúng
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            saveAnswer(q.id, { statements: { ...current, [s.key]: false } })
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            current[s.key] === false ? "bg-red-600 text-white" : "bg-slate-100"
                          }`}
                        >
                          Sai
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {q.type === "short_answer" && (
              <input
                value={(answers[q.id] as { text: string } | undefined)?.text ?? ""}
                onChange={(e) => saveAnswer(q.id, { text: e.target.value })}
                placeholder="Nhập đáp án"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            )}
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t bg-white p-4">
        <div className="mx-auto flex max-w-3xl justify-end">
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-slate-900 px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Đang nộp..." : "Nộp bài"}
          </button>
        </div>
      </div>
    </div>
  );
}
