import { readFileSync } from "fs";
import { detectDocxBranch, extractDocx } from "../src/lib/extraction/docxExtract";
import { structureExamText } from "../src/lib/extraction/llmClient";
import { normalizeExtractedExam } from "../src/lib/extraction/normalize";

async function main() {
  const path = process.argv[2];
  const buf = readFileSync(path);

  const branch = await detectDocxBranch(buf);
  console.log("Branch:", branch);

  const result = await extractDocx(buf);
  console.log("Text length:", result.text.length);
  console.log("Images found:", [...result.images.keys()]);
  console.log("Warnings:", result.warnings.length);

  console.log("Calling LLM to structure...");
  const structured = await structureExamText(result.text);
  const normalized = normalizeExtractedExam({ ...structured, source_branch: branch });

  console.log("Title:", normalized.title);
  console.log("Subject:", normalized.subject);
  console.log("Question count:", normalized.questions.length);
  const mc = normalized.questions.filter((q) => q.type === "multiple_choice");
  console.log("MC correct answers:", mc.map((q) => q.correct_answer).join(","));
  const withImages = normalized.questions.filter((q) => q.image_urls.length > 0);
  console.log("Questions with image_urls set:", withImages.map((q) => q.image_urls));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
