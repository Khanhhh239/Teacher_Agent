import type { Question, StudentAnswerPayload } from "@/types/exam";

/** Chuẩn hóa chuỗi trả lời ngắn: bỏ khoảng trắng thừa, đưa dấu thập phân về ".", hạ thường. */
export function normalizeShortAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(",", ".");
}

/** Quy tắc chấm điểm phần Đúng/Sai theo cấu trúc đề THPT 2025: điểm theo số mệnh đề đúng. */
function scoreTrueFalseThpt2025(correctCount: number, maxScore: number): number {
  switch (correctCount) {
    case 1:
      return roundScore(maxScore * 0.1);
    case 2:
      return roundScore(maxScore * 0.25);
    case 3:
      return roundScore(maxScore * 0.5);
    case 4:
      return roundScore(maxScore);
    default:
      return 0;
  }
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ScoreResult {
  is_correct: boolean;
  score: number;
}

export function scoreQuestion(question: Question, answer: StudentAnswerPayload | undefined): ScoreResult {
  if (!answer) return { is_correct: false, score: 0 };

  switch (question.type) {
    case "multiple_choice": {
      if (!("selected" in answer)) return { is_correct: false, score: 0 };
      const correct = answer.selected === question.correct_answer;
      return { is_correct: correct, score: correct ? question.max_score : 0 };
    }

    case "true_false_group": {
      if (!("statements" in answer)) return { is_correct: false, score: 0 };
      const correctCount = question.sub_statements.filter(
        (s) => answer.statements[s.key] === s.answer
      ).length;
      const allCorrect = correctCount === question.sub_statements.length;

      if (question.score_rule === "thpt2025_truefalse_partial") {
        return {
          is_correct: allCorrect,
          score: scoreTrueFalseThpt2025(correctCount, question.max_score),
        };
      }

      // standard: chấm nhị phân, tất cả mệnh đề phải đúng mới có điểm
      return { is_correct: allCorrect, score: allCorrect ? question.max_score : 0 };
    }

    case "short_answer": {
      if (!("text" in answer)) return { is_correct: false, score: 0 };
      const expected = question.short_answer_normalized ?? "";
      const correct =
        normalizeShortAnswer(answer.text) === normalizeShortAnswer(expected);
      return { is_correct: correct, score: correct ? question.max_score : 0 };
    }

    default:
      return { is_correct: false, score: 0 };
  }
}

export function scoreExam(
  questions: Question[],
  answers: Map<string, StudentAnswerPayload>
): { totalScore: number; perQuestion: Map<string, ScoreResult> } {
  const perQuestion = new Map<string, ScoreResult>();
  let totalScore = 0;

  for (const q of questions) {
    const result = scoreQuestion(q, answers.get(q.id));
    perQuestion.set(q.id, result);
    totalScore += result.score;
  }

  return { totalScore: roundScore(totalScore), perQuestion };
}
