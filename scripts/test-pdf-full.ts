import { readFileSync } from "fs";
import { extractPdfWithVision } from "../src/lib/extraction/llmClient";

async function main() {
  const buf = readFileSync(process.argv[2]);
  const r = await extractPdfWithVision(buf);
  console.log("Title:", r.title);
  console.log("Questions:", r.questions.length);
  console.log("Types:", r.questions.map((q) => q.type).join(","));
  const mc = r.questions.filter((q) => q.type === "multiple_choice");
  console.log("Sample Q1 content:", mc[0]?.content_latex);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
