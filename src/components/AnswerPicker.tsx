"use client";

import { memo } from "react";
import type { QuestionType, StudentAnswerPayload } from "@/types/exam";

/**
 * Ô trả lời gọn (kiểu phiếu trắc nghiệm giấy): trắc nghiệm = hàng nút A/B/C/D, đúng/sai = 1
 * hàng riêng cho mỗi ý "{số}{a-d}) Đúng Sai", điền ngắn = ô nhập. Dùng chung cho 3 nơi: học
 * sinh làm bài (tương tác), giáo viên duyệt (tương tác, có sẵn đáp án từ file đáp án), trang
 * kết quả (chỉ đọc, tô màu đúng/sai) — truyền `onChange` để tương tác, bỏ trống để chỉ đọc.
 */
export interface AnswerPickerProps {
  number: number;
  type: QuestionType;
  optionKeys: string[];
  subKeys: string[];
  value: StudentAnswerPayload | null;
  onChange?: (value: StudentAnswerPayload) => void;
  /** Có thì tô xanh/đỏ theo đúng-sai thay vì chỉ tô xanh "đang chọn" — dùng ở trang kết quả. */
  showCorrectness?: boolean;
  correctAnswer?: string | null;
  correctStatements?: Record<string, boolean> | null;
  correctText?: string | null;
}

function Btn({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "neutral" | "green" | "red";
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "green"
      ? "bg-green-600 text-white border-green-600"
      : tone === "red"
        ? "bg-red-600 text-white border-red-600"
        : active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 border-slate-300 hover:border-slate-400";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`h-7 min-w-7 rounded border px-1.5 text-xs font-semibold ${toneClass} ${!onClick ? "cursor-default" : ""}`}
    >
      {children}
    </button>
  );
}

function AnswerPickerImpl({
  number,
  type,
  optionKeys,
  subKeys,
  value,
  onChange,
  showCorrectness,
  correctAnswer,
  correctStatements,
  correctText,
}: AnswerPickerProps) {
  if (type === "multiple_choice") {
    const selected = (value as { selected: string } | null)?.selected;
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5">
        <span className="w-7 shrink-0 text-right text-xs font-bold text-slate-500">{number}</span>
        {optionKeys.map((key) => {
          const isSelected = selected === key;
          const isCorrectKey = key === correctAnswer;
          let tone: "neutral" | "green" | "red" = "neutral";
          if (showCorrectness) {
            if (isCorrectKey) tone = "green";
            else if (isSelected) tone = "red";
          }
          return (
            <Btn key={key} active={isSelected} tone={tone} onClick={onChange ? () => onChange({ selected: key }) : undefined}>
              {key}
            </Btn>
          );
        })}
      </div>
    );
  }

  if (type === "true_false_group") {
    const statements = (value as { statements: Record<string, boolean> } | null)?.statements ?? {};
    return (
      <div className="space-y-1 rounded-md border border-slate-200 px-2 py-1.5">
        {subKeys.map((key) => {
          const current = statements[key];
          const correctVal = correctStatements?.[key];
          const dungTone: "neutral" | "green" | "red" = !showCorrectness
            ? "neutral"
            : correctVal === true
              ? "green"
              : current === true
                ? "red"
                : "neutral";
          const saiTone: "neutral" | "green" | "red" = !showCorrectness
            ? "neutral"
            : correctVal === false
              ? "green"
              : current === false
                ? "red"
                : "neutral";
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-right text-xs font-bold text-slate-500">
                {number}
                {key})
              </span>
              <Btn active={current === true} tone={dungTone} onClick={onChange ? () => onChange({ statements: { ...statements, [key]: true } }) : undefined}>
                Đúng
              </Btn>
              <Btn active={current === false} tone={saiTone} onClick={onChange ? () => onChange({ statements: { ...statements, [key]: false } }) : undefined}>
                Sai
              </Btn>
              {showCorrectness && current !== correctVal && (
                <span className="text-[11px] text-slate-500">(đúng: {correctVal ? "Đúng" : "Sai"})</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // short_answer
  const text = (value as { text: string } | null)?.text ?? "";
  const isWrong = showCorrectness && correctText != null && text.trim() !== "" && text !== correctText;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5">
      <span className="w-7 shrink-0 text-right text-xs font-bold text-slate-500">{number}</span>
      {onChange ? (
        <input
          value={text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Đáp án"
          className="h-7 w-28 rounded border border-slate-300 px-2 text-xs"
        />
      ) : (
        <span className={`text-xs font-semibold ${showCorrectness ? (isWrong ? "text-red-600" : "text-green-700") : ""}`}>
          {text || "(bỏ trống)"}
        </span>
      )}
      {showCorrectness && isWrong && <span className="text-[11px] text-slate-500">(đúng: {correctText})</span>}
    </div>
  );
}

// Danh sách câu hỏi re-render toàn bộ parent mỗi lần học sinh bấm 1 đáp án (setState ở cha) —
// memo hoá để chỉ MỘT hàng vừa đổi `value` mới tính lại, không phải cả 20-50 câu. `onChange`
// cố tình KHÔNG so sánh vì nó là closure mới mỗi render nhưng hành vi không đổi.
export const AnswerPicker = memo(AnswerPickerImpl, (prev, next) => {
  return (
    prev.number === next.number &&
    prev.type === next.type &&
    prev.optionKeys === next.optionKeys &&
    prev.subKeys === next.subKeys &&
    prev.value === next.value &&
    prev.showCorrectness === next.showCorrectness &&
    prev.correctAnswer === next.correctAnswer &&
    prev.correctStatements === next.correctStatements &&
    prev.correctText === next.correctText
  );
});
