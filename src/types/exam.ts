export type QuestionType = "multiple_choice" | "true_false_group" | "short_answer";
export type ScoreRule = "standard" | "thpt2025_truefalse_partial";

export interface QuestionOption {
  key: string;
  text_latex: string;
}

export interface SubStatement {
  key: string;
  text_latex: string;
  answer: boolean;
}

export interface Question {
  id: string;
  exam_id: string;
  order_index: number;
  type: QuestionType;
  content_latex: string;
  part_label: string | null;
  image_urls: string[];
  options: QuestionOption[];
  sub_statements: SubStatement[];
  correct_answer: string | null;
  short_answer_normalized: string | null;
  score_rule: ScoreRule;
  max_score: number;
  needs_review: boolean;
  raw_ocr_notes: string | null;
}

export type ExamStatus = "draft" | "reviewing" | "ready" | "archived";
export type SourceBranch = "OMML_NATIVE" | "LEGACY_OLE_IMAGE" | "PDF_IMAGE_ONLY" | "PDF_TEXT_LAYER" | "MANUAL";

export interface ExamSettings {
  shuffle_questions: boolean;
  shuffle_options: boolean;
  anti_cheat: boolean;
}

export interface Exam {
  id: string;
  teacher_id: string;
  title: string;
  subject: string;
  duration_minutes: number;
  status: ExamStatus;
  source_branch: SourceBranch | null;
  settings: ExamSettings;
  original_file_url: string | null;
  original_file_ext: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamRoom {
  id: string;
  exam_id: string;
  code: string;
  opens_at: string | null;
  closes_at: string | null;
  is_active: boolean;
  require_fullscreen: boolean;
  max_attempts: number;
  violation_kick_limit: number;
  created_at: string;
}

export type SessionStatus = "in_progress" | "submitted" | "graded";

export interface ExamSession {
  id: string;
  room_id: string;
  student_name: string;
  student_code: string;
  question_order: string[];
  option_order: Record<string, string[]>;
  status: SessionStatus;
  started_at: string;
  submitted_at: string | null;
  total_score: number | null;
  violation_count: number;
  kicked_at: string | null;
}

export type StudentAnswerPayload =
  | { selected: string }
  | { statements: Record<string, boolean> }
  | { text: string };

export interface StudentAnswer {
  id: string;
  session_id: string;
  question_id: string;
  answer: StudentAnswerPayload;
  is_correct: boolean | null;
  score: number | null;
}

export type ViolationType =
  | "tab_blur"
  | "fullscreen_exit"
  | "devtools_key"
  | "copy_paste"
  | "right_click"
  | "window_resize";

export interface ExamViolation {
  id: string;
  session_id: string;
  type: ViolationType;
  occurred_at: string;
  meta: Record<string, unknown>;
}

/** JSON đầu ra chuẩn hóa từ extraction pipeline (khớp pipeline/schema.py) */
export interface ExtractedExam {
  title: string;
  subject: string;
  source_branch: SourceBranch;
  questions: Array<{
    type: QuestionType;
    content_latex: string;
    part_label: string | null;
    image_urls: string[];
    options: QuestionOption[];
    sub_statements: SubStatement[];
    correct_answer: string | null;
    short_answer_normalized: string | null;
    score_rule: ScoreRule;
    max_score: number;
    raw_ocr_notes: string | null;
  }>;
}
