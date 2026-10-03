"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QuestionAnswerSplit, type SplitQuestion } from "@/components/QuestionAnswerSplit";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { VIOLATION_LABELS } from "@/lib/violationLabels";
import type { QuestionType, StudentAnswerPayload, ViolationType } from "@/types/exam";

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
  student_code: string;
  require_fullscreen: boolean;
  violation_kick_limit: number;
  remaining_seconds: number;
  questions: ExamQuestion[];
  existing_answers: { question_id: string; answer: StudentAnswerPayload }[];
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Sau khi nộp bài / bị đuổi, đưa học sinh ra khỏi phòng thi hẳn (không cho quay lại bằng nút
 * Back) — thay thế lịch sử trình duyệt bằng trang vào phòng thi. */
function lockOutAndRedirect(router: ReturnType<typeof useRouter>) {
  setTimeout(() => {
    router.replace("/exam/join");
  }, 2500);
}

export default function TakeExamPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<SessionData | null>(null);
  const [answers, setAnswers] = useState<Record<string, StudentAnswerPayload | null>>({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const doSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await fetch(`/api/sessions/${sessionId}/submit`, { method: "POST" });
    setSubmitting(false);
    setSubmitted(true);
    lockOutAndRedirect(router);
  }, [sessionId, router]);

  const handleKicked = useCallback(() => {
    setKicked(true);
    doSubmit();
    lockOutAndRedirect(router);
  }, [doSubmit, router]);

  const handleViolation = useCallback((type: ViolationType, count: number, limit: number) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const label = VIOLATION_LABELS[type] ?? type;
    setToast({ text: `⚠ Vi phạm: ${label} (lần ${count}/${limit}) — vi phạm đủ số lần sẽ tự động nộp bài.`, key: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    if (!data) return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          doSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [data, doSubmit]);

  useAntiCheat(
    sessionId,
    !!data && data.status === "in_progress",
    data?.require_fullscreen ?? false,
    handleKicked,
    handleViolation
  );

  function saveAnswer(questionId: string, answer: StudentAnswerPayload) {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    fetch(`/api/sessions/${sessionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, answer }),
    }).catch(() => {});
  }

  function openConfirm() {
    setConfirmCode("");
    setConfirmError(null);
    setConfirmOpen(true);
  }

  function confirmSubmit() {
    if (!data) return;
    if (confirmCode.trim().toLowerCase() !== data.student_code.trim().toLowerCase()) {
      setConfirmError("Số báo danh không khớp — vui lòng nhập đúng số báo danh bạn đã dùng để vào phòng thi.");
      return;
    }
    setConfirmOpen(false);
    doSubmit();
  }

  // useMemo phải gọi vô điều kiện (Rules of Hooks) nên đặt trước các early-return bên dưới —
  // tránh build lại mảng/object mới mỗi lần render (mỗi lần bấm 1 đáp án) để AnswerPicker/
  // QuestionImageCard đã memo hoá thực sự nhận được props ổn định và không bị tính lại oan.
  const splitQuestions: SplitQuestion[] = useMemo(
    () =>
      (data?.questions ?? []).map((q, idx) => ({
        id: q.id,
        number: idx + 1,
        part_label: q.part_label,
        source_crop_url: q.source_crop_url,
        type: q.type,
        optionKeys: q.options.map((o) => o.key),
        subKeys: q.sub_statements.map((s) => s.key),
      })),
    [data?.questions]
  );

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
        <p className="text-slate-500">Đang tải đề thi...</p>
      </div>
    );
  }

  if (kicked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-4 text-center">
        <div className="card max-w-sm p-6">
          <p className="text-lg font-semibold text-red-700">Bạn đã bị tự động nộp bài</p>
          <p className="mt-1 text-sm text-slate-600">Do vi phạm quy định phòng thi quá số lần cho phép. Đang đưa bạn ra khỏi phòng thi...</p>
        </div>
      </div>
    );
  }

  if (submitted || data.status !== "in_progress") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-4 text-center">
        <div className="card max-w-sm p-6">
          <p className="text-lg font-semibold text-green-700">Đã nộp bài thành công</p>
          <p className="mt-1 text-sm text-slate-600">Kết quả sẽ được giáo viên công bố. Đang đưa bạn ra khỏi phòng thi...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-[10px] font-bold text-white">
            AI
          </span>
          <h1 className="font-semibold text-slate-900">{data.exam_title}</h1>
        </div>
        <span
          className={`rounded-lg px-3 py-1.5 font-mono text-lg font-bold tabular-nums ${
            remaining < 300 ? "bg-red-100 text-red-700" : "bg-indigo-50 text-indigo-700"
          }`}
        >
          {formatTime(remaining)}
        </span>
      </header>

      {toast && (
        <div key={toast.key} className="shrink-0 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
          {toast.text}
        </div>
      )}

      <div className="min-h-0 flex-1 p-4">
        <QuestionAnswerSplit questions={splitQuestions} values={answers} onChange={saveAnswer} />
      </div>

      <div className="shrink-0 border-t bg-white p-3">
        <div className="flex justify-end">
          <button onClick={openConfirm} disabled={submitting} className="btn-primary px-6 py-2.5">
            {submitting ? "Đang nộp..." : "Nộp bài"}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="mb-1 font-semibold text-slate-900">Xác nhận nộp bài</h2>
            <p className="mb-4 text-sm text-slate-600">
              Sau khi nộp sẽ không thể sửa lại câu trả lời. Nhập lại <strong>Số báo danh</strong> của bạn để xác nhận.
            </p>
            <input
              autoFocus
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              placeholder="Số báo danh"
              className="input-field mb-2"
              onKeyDown={(e) => e.key === "Enter" && confirmSubmit()}
            />
            {confirmError && <p className="mb-2 text-sm text-red-600">{confirmError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="btn-secondary">
                Quay lại làm bài
              </button>
              <button onClick={confirmSubmit} className="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700">
                Xác nhận nộp bài
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
