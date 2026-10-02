"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QuestionAnswerSplit, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import type { QuestionType, StudentAnswerPayload } from "@/types/exam";

interface ExamQuestion {
  id: string;
  type: QuestionType;
  part_label: string | null;
  source_crop_url: string | null;
  options: { key: string }[];
  sub_statements: { key: string }[];
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
  const [answers, setAnswers] = useState<Record<string, StudentAnswerPayload | null>>({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d: SessionData) => {
        setData(d);
        setRemaining(d.remaining_seconds);
        const initial: Record<string, StudentAnswerPayload | null> = {};
        for (const a of d.existing_answers) initial[a.question_id] = a.answer;
        setAnswers(initial);
      });
  }, [sessionId]);

  const [kicked, setKicked] = useState(false);

  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await fetch(`/api/sessions/${sessionId}/submit`, { method: "POST" });
    router.push(`/exam/${sessionId}/result`);
  }, [sessionId, router]);

  const handleKicked = useCallback(() => {
    setKicked(true);
    submit();
  }, [submit]);

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

  useAntiCheat(sessionId, !!data && data.status === "in_progress", data?.require_fullscreen ?? false, handleKicked);

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

  if (kicked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-center">
        Bạn đã bị tự động nộp bài do vi phạm quy định phòng thi quá số lần cho phép.
      </div>
    );
  }

  if (data.status !== "in_progress") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Bài thi này đã được nộp trước đó.
      </div>
    );
  }

  const splitQuestions: SplitQuestion[] = data.questions.map((q, idx) => ({
    id: q.id,
    number: idx + 1,
    part_label: q.part_label,
    source_crop_url: q.source_crop_url,
    type: q.type,
    optionKeys: q.options.map((o) => o.key),
    subKeys: q.sub_statements.map((s) => s.key),
  }));

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-3 shadow-sm">
        <h1 className="font-semibold">{data.exam_title}</h1>
        <span
          className={`rounded-md px-3 py-1 font-mono text-lg font-bold ${
            remaining < 300 ? "bg-red-100 text-red-700" : "bg-slate-100"
          }`}
        >
          {formatTime(remaining)}
        </span>
      </header>

      <div className="min-h-0 flex-1 p-4">
        <QuestionAnswerSplit questions={splitQuestions} values={answers} onChange={saveAnswer} />
      </div>

      <div className="shrink-0 border-t bg-white p-3">
        <div className="flex justify-end">
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
