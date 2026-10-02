import { buildQuestionsFromAnswerKey } from "../src/lib/extraction/imageQuestionPipeline";
import type { AnswerKeyEntry } from "../src/lib/extraction/llmClient";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
  if (!cond) failed++;
}

const key: AnswerKeyEntry[] = [
  { question_number: 1, type: "multiple_choice", correct_answer: "b" },
  { question_number: 2, type: "true_false_group", sub_statements: [{ key: "a", answer: true }, { key: "b", answer: false }, { key: "c", answer: true }, { key: "d", answer: true }] },
  { question_number: 3, type: "short_answer", value: "4,9" },
];
const parts = ["PHẦN I", "PHẦN II", "PHẦN III", null];
const rows = buildQuestionsFromAnswerKey(4, parts, key);

check("row count == question count", rows.length === 4);
check("Q1 multiple_choice, answer B uppercased", rows[0].type === "multiple_choice" && rows[0].correct_answer === "B" && rows[0].options.length === 4);
// Fixture này có 4 câu nhưng chỉ 3 đáp án (cố ý) nên Q1 nhận cảnh báo lệch số lượng.
check("Q1 not blocking (answer merged ok)", !rows[0].blocking);
check("Q1 flagged for count mismatch (4 vs 3)", rows[0].flags.some((f) => f.includes("4 câu") && f.includes("3 câu")));
check("Q2 true_false_group, 4 sub_statements with right answers", rows[1].type === "true_false_group" && rows[1].sub_statements.map((s) => s.answer).join(",") === "true,false,true,true");
check("Q2 score_rule partial, max_score 1.0", rows[1].score_rule === "thpt2025_truefalse_partial" && rows[1].max_score === 1.0);
check("Q3 short_answer value kept, max_score 0.5", rows[2].type === "short_answer" && rows[2].short_answer_normalized === "4,9" && rows[2].max_score === 0.5);
check("Q4 missing key -> blocking fallback multiple_choice, 4 empty options", rows[3].type === "multiple_choice" && rows[3].blocking && rows[3].options.length === 4 && rows[3].correct_answer === null);
check("Q4 flag mentions question 4", rows[3].flags.some((f) => f.includes("câu 4")));
check("part_label carried through", rows[0].part_label === "PHẦN I" && rows[3].part_label === null);

// Partial true/false (file đáp án chỉ có 3/4 ý)
const partialKey: AnswerKeyEntry[] = [{ question_number: 1, type: "true_false_group", sub_statements: [{ key: "a", answer: true }, { key: "b", answer: false }, { key: "c", answer: true }] }];
const partialRows = buildQuestionsFromAnswerKey(1, [null], partialKey);
check("partial TF: 4 sub_statements still created (d defaults false)", partialRows[0].sub_statements.length === 4 && partialRows[0].sub_statements[3].answer === false);
check("partial TF: flagged 3/4", partialRows[0].flags.some((f) => f.includes("3/4")));

// Count mismatch between exam and answer key
const mismatchKey: AnswerKeyEntry[] = [{ question_number: 1, type: "multiple_choice", correct_answer: "A" }];
const mismatchRows = buildQuestionsFromAnswerKey(3, [null, null, null], mismatchKey);
check("count mismatch flagged once", mismatchRows.some((r) => r.flags.some((f) => f.includes("3 câu") && f.includes("1 câu"))));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
