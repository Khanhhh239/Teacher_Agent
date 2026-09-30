"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LatexText } from "@/components/Latex";
import type { Question, QuestionOption, SubStatement } from "@/types/exam";

export function QuestionEditor({ question }: { question: Question }) {
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
    <div className={`rounded-lg border bg-white p-4 ${q.needs_review ? "border-amber-400" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          Câu {q.order_index + 1} · {q.type} · {q.max_score}đ
        </span>
        {q.needs_review && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Cần duyệt OCR
          </span>
        )}
      </div>

      {!editing ? (
        <div>
          <p className="mb-2">
            <LatexText text={q.content_latex} />
          </p>
          {q.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={q.image_url} alt="" className="mb-2 max-h-60 rounded border" />
          )}
          {q.type === "multiple_choice" && (
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {q.options.map((o) => (
                <li key={o.key} className={o.key === q.correct_answer ? "font-semibold text-green-700" : ""}>
                  {o.key}. <LatexText text={o.text_latex} />
                </li>
              ))}
            </ul>
          )}
          {q.type === "true_false_group" && (
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {q.sub_statements.map((s) => (
                <li key={s.key}>
                  {s.key}) <LatexText text={s.text_latex} /> —{" "}
                  <span className={s.answer ? "text-green-700" : "text-red-700"}>
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
            <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-500">
              Ghi chú OCR gốc: {q.raw_ocr_notes}
            </p>
          )}
          <button onClick={() => setEditing(true)} className="mt-3 text-sm text-slate-600 underline">
            Sửa
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Nội dung (LaTeX bọc trong $...$)</label>
            <textarea
              value={q.content_latex}
              onChange={(e) => setQ({ ...q, content_latex: e.target.value })}
              rows={3}
              className="w-full rounded-md border px-2 py-1 font-mono text-sm"
            />
          </div>

          {q.type === "multiple_choice" && (
            <div className="space-y-2">
              {q.options.map((o, idx) => (
                <div key={o.key} className="flex items-center gap-2">
                  <span className="w-6 text-sm font-medium">{o.key}</span>
                  <input
                    value={o.text_latex}
                    onChange={(e) => updateOption(idx, { text_latex: e.target.value })}
                    className="flex-1 rounded-md border px-2 py-1 font-mono text-sm"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      checked={q.correct_answer === o.key}
                      onChange={() => setQ({ ...q, correct_answer: o.key })}
                    />
                    Đúng
                  </label>
                </div>
              ))}
            </div>
          )}

          {q.type === "true_false_group" && (
            <div className="space-y-2">
              {q.sub_statements.map((s, idx) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-6 text-sm font-medium">{s.key}</span>
                  <input
                    value={s.text_latex}
                    onChange={(e) => updateStatement(idx, { text_latex: e.target.value })}
                    className="flex-1 rounded-md border px-2 py-1 font-mono text-sm"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={s.answer}
                      onChange={(e) => updateStatement(idx, { answer: e.target.checked })}
                    />
                    Đúng
                  </label>
                </div>
              ))}
              <label className="flex items-center gap-2 text-xs">
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
              <label className="mb-1 block text-xs font-medium">Đáp án đúng</label>
              <input
                value={q.short_answer_normalized ?? ""}
                onChange={(e) => setQ({ ...q, short_answer_normalized: e.target.value })}
                className="w-full rounded-md border px-2 py-1 font-mono text-sm"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium">Điểm tối đa</label>
            <input
              type="number"
              step="0.05"
              value={q.max_score}
              onChange={(e) => setQ({ ...q, max_score: Number(e.target.value) })}
              className="w-28 rounded-md border px-2 py-1 text-sm"
            />
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu & đánh dấu đã duyệt"}
          </button>
        </div>
      )}
    </div>
  );
}
