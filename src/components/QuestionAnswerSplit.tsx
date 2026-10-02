"use client";

import { AnswerPicker } from "@/components/AnswerPicker";
import { QuestionImageCard } from "@/components/QuestionImageCard";
import { ResizableSplitView } from "@/components/ResizableSplitView";
import type { QuestionType, StudentAnswerPayload } from "@/types/exam";

export interface SplitQuestion {
  id: string;
  number: number;
  part_label: string | null;
  source_crop_url: string | null;
  type: QuestionType;
  optionKeys: string[];
  subKeys: string[];
}

export interface Correctness {
  correctAnswer?: string | null;
  correctStatements?: Record<string, boolean> | null;
  correctText?: string | null;
}

/**
 * Bố cục dùng chung: trái = ảnh gốc từng câu (cuộn riêng), phải = phiếu trả lời gọn kiểu
 * trắc nghiệm giấy (cuộn riêng), có thanh kéo ở giữa (ResizableSplitView). Dùng cho cả 3 nơi:
 * học sinh làm bài, giáo viên duyệt (đáp án có sẵn từ file đáp án, sửa được), trang kết quả
 * (chỉ đọc, tô màu đúng/sai) — chỉ khác nhau ở `onChange`/`showCorrectness`/`correctness`.
 */
export function QuestionAnswerSplit({
  questions,
  values,
  onChange,
  showCorrectness,
  correctness,
  renderImageExtra,
  rightWidthDefaultPct = 34,
}: {
  questions: SplitQuestion[];
  values: Record<string, StudentAnswerPayload | null>;
  onChange?: (id: string, value: StudentAnswerPayload) => void;
  showCorrectness?: boolean;
  correctness?: Record<string, Correctness>;
  renderImageExtra?: (q: SplitQuestion) => React.ReactNode;
  rightWidthDefaultPct?: number;
}) {
  return (
    <ResizableSplitView
      initialRightWidthPct={rightWidthDefaultPct}
      left={
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <QuestionImageCard
              key={q.id}
              number={q.number}
              partLabel={q.part_label}
              showPartHeader={!!q.part_label && q.part_label !== questions[idx - 1]?.part_label}
              imageUrl={q.source_crop_url}
              extra={renderImageExtra?.(q)}
            />
          ))}
          {questions.length === 0 && (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">Đề thi chưa có câu hỏi nào.</p>
          )}
        </div>
      }
      right={
        <div className="space-y-1.5">
          {questions.map((q) => {
            const c = correctness?.[q.id];
            return (
              <AnswerPicker
                key={q.id}
                number={q.number}
                type={q.type}
                optionKeys={q.optionKeys}
                subKeys={q.subKeys}
                value={values[q.id] ?? null}
                onChange={onChange ? (v) => onChange(q.id, v) : undefined}
                showCorrectness={showCorrectness}
                correctAnswer={c?.correctAnswer}
                correctStatements={c?.correctStatements}
                correctText={c?.correctText}
              />
            );
          })}
        </div>
      }
    />
  );
}
