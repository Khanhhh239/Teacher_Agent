"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LatexText } from "@/components/Latex";
import type { Question, QuestionOption, SubStatement } from "@/types/exam";

function PreviewBox({ text }: { text: string }) {
  if (!text.trim()) {
    return <p className="rounded-md border border-dashed bg-slate-50 px-3 py-2 text-sm text-slate-400">Xem trước...</p>;
  }
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <LatexText text={text} />
    </p>
  );
}

export function QuestionEditor({ question }: { question: Question }) {
  const router = useRouter();
  const [q, setQ] = useState(question);
  const [editing, setEditing] = useState(question.needs_review);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("questions")
      .update({
        content_latex: q.content_latex,
        options: q.options,
        sub_statements: q.sub_statements,
        correct_answer: q.correct_answer,
        short_answer_normalized: q.short_answer_normalized,
        score_rule: q.score_rule,
        max_score: q.max_score,
        needs_review: false,
      })
      .eq("id", q.id);
    setSaving(false);
    setEditing(false);
    setQ({ ...q, needs_review: false });
    // Đồng bộ lại số "câu chưa duyệt" tính ở Server Component cha (ExamStatusControls)
    router.refresh();
  }

  function updateOption(idx: number, patch: Partial<QuestionOption>) {
    const options = [...q.options];
    options[idx] = { ...options[idx], ...patch };
    setQ({ ...q, options });
  }

  function updateStatement(idx: number, patch: Partial<SubStatement>) {
    const sub_statements = [...q.sub_statements];
    sub_statements[idx] = { ...sub_statements[idx], ...patch };
    setQ({ ...q, sub_statements });
  }

  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm ${q.needs_review ? "border-amber-400 ring-1 ring-amber-200" : "border-slate-200"}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          Câu {q.order_index + 1} · {q.type} · {q.max_score}đ
        </span>
        {q.needs_review && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Cần duyệt OCR
          </span>
        )}
      </div>

      {/* Ảnh minh họa luôn hiển thị (cả khi đang sửa) — giáo viên cần đối chiếu nội dung với ảnh gốc */}
      {q.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.image_url} alt="" className="mb-3 max-h-72 rounded-md border" />
      )}

      {!editing ? (
        <div>
          <p className="mb-3 text-[15px] leading-relaxed">
            <LatexText text={q.content_latex} />
          </p>
          {q.type === "multiple_choice" && (
            <ul className="ml-1 space-y-1.5 text-sm">
              {q.options.map((o) => (
                <li
                  key={o.key}
                  className={`rounded-md px-2 py-1 ${o.key === q.correct_answer ? "bg-green-50 font-semibold text-green-700" : ""}`}
                >
                  {o.key}. <LatexText text={o.text_latex} />
                </li>
              ))}
            </ul>
          )}
          {q.type === "true_false_group" && (
            <ul className="ml-1 space-y-1.5 text-sm">
              {q.sub_statements.map((s) => (
                <li key={s.key} className="rounded-md px-2 py-1">
                  {s.key}) <LatexText text={s.text_latex} /> —{" "}
                  <span className={s.answer ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
                    {s.answer ? "Đúng" : "Sai"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {q.type === "short_answer" && (
            <p className="text-sm">
              Đáp án: <span className="font-semibold">{q.short_answer_normalized}</span>
            </p>
          )}
          {q.raw_ocr_notes && (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              ⚠ Ghi chú OCR: {q.raw_ocr_notes}
            </p>
          )}
          <button onClick={() => setEditing(true)} className="mt-3 text-sm font-medium text-slate-600 underline">
            Sửa
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Nội dung (gõ LaTeX bọc trong $...$, vd: $\vec{"{"}u{"}"}$)
            </label>
            <textarea
              value={q.content_latex}
              onChange={(e) => setQ({ ...q, content_latex: e.target.value })}
              rows={3}
              className="w-full rounded-md border px-2 py-1.5 font-mono text-sm"
            />
            <p className="mb-1 mt-1.5 text-xs text-slate-500">Xem trước (hiển thị cho học sinh):</p>
            <PreviewBox text={q.content_latex} />
          </div>

          {q.type === "multiple_choice" && (
            <div className="space-y-3">
              {q.options.map((o, idx) => (
                <div key={o.key} className="rounded-md border border-slate-200 p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="w-5 text-sm font-semibold">{o.key}</span>
                    <input
                      value={o.text_latex}
                      onChange={(e) => updateOption(idx, { text_latex: e.target.value })}
                      className="flex-1 rounded-md border px-2 py-1 font-mono text-sm"
                    />
                    <label className="flex shrink-0 items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={`correct-${q.id}`}
                        checked={q.correct_answer === o.key}
                        onChange={() => setQ({ ...q, correct_answer: o.key })}
                      />
                      Đáp án đúng
                    </label>
                  </div>
                  <div className="pl-7">
                    <PreviewBox text={o.text_latex} />
                  </div>
                </div>
              ))}
              {!q.correct_answer && (
                <p className="text-xs font-medium text-red-600">⚠ Chưa chọn đáp án đúng cho câu này.</p>
              )}
            </div>
          )}

          {q.type === "true_false_group" && (
            <div className="space-y-3">
              {q.sub_statements.map((s, idx) => (
                <div key={s.key} className="rounded-md border border-slate-200 p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="w-5 text-sm font-semibold">{s.key}</span>
                    <input
                      value={s.text_latex}
                      onChange={(e) => updateStatement(idx, { text_latex: e.target.value })}
                      className="flex-1 rounded-md border px-2 py-1 font-mono text-sm"
                    />
                    <label className="flex shrink-0 items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={s.answer}
                        onChange={(e) => updateStatement(idx, { answer: e.target.checked })}
                      />
                      Đúng
                    </label>
                  </div>
                  <div className="pl-7">
                    <PreviewBox text={s.text_latex} />
                  </div>
                </div>
              ))}
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={q.score_rule === "thpt2025_truefalse_partial"}
                  onChange={(e) =>
                    setQ({
                      ...q,
                      score_rule: e.target.checked ? "thpt2025_truefalse_partial" : "standard",
                    })
                  }
                />
                Chấm điểm từng phần theo quy chế THPT 2025 (1 đúng=0.1đ, 2=0.25đ, 3=0.5đ, 4=1đ)
              </label>
            </div>
          )}

          {q.type === "short_answer" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Đáp án đúng</label>
              <input
                value={q.short_answer_normalized ?? ""}
                onChange={(e) => setQ({ ...q, short_answer_normalized: e.target.value })}
                className="w-full rounded-md border px-2 py-1.5 font-mono text-sm"
              />
            </div>
          )}

          {q.raw_ocr_notes && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">⚠ Ghi chú OCR: {q.raw_ocr_notes}</p>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Điểm tối đa</label>
            <input
              type="number"
              step="0.05"
              value={q.max_score}
              onChange={(e) => setQ({ ...q, max_score: Number(e.target.value) })}
              className="w-28 rounded-md border px-2 py-1.5 text-sm"
            />
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu & đánh dấu đã duyệt"}
          </button>
        </div>
      )}
    </div>
  );
}
