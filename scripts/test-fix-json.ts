import { readFileSync } from "fs";
import { fixLatexBackslashes } from "../src/lib/extraction/llmClient";

const raw = readFileSync(process.argv[2], "utf-8");
const fixed = fixLatexBackslashes(raw);

try {
  const parsed = JSON.parse(fixed);
  console.log("PARSE OK. Question count:", parsed.questions.length);
  console.log("Sample option text_latex:", parsed.questions[0].options[0].text_latex);
  console.log("Sample option text_latex (2):", parsed.questions[0].options[1].text_latex);
} catch (e) {
  console.error("PARSE FAILED:", e);
  console.log("---FIXED SNIPPET AROUND ERROR---");
  const match = String(e).match(/position (\d+)/);
  if (match) {
    const pos = Number(match[1]);
    console.log(fixed.slice(Math.max(0, pos - 100), pos + 100));
  }
}
