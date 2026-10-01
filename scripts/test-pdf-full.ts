import { readFileSync, writeFileSync } from "fs";
import { extractPdfPages } from "../src/lib/extraction/llmClient";

async function main() {
  const buf = readFileSync(process.argv[2]);
  const { extracted, images } = await extractPdfPages(buf);
  console.log("Title:", extracted.title);
  console.log("Questions:", extracted.questions.length);
  console.log("Types:", extracted.questions.map((q) => q.type).join(","));
  console.log("Images extracted:", [...images.keys()]);
  const withImages = extracted.questions.filter((q) => q.image_urls.length > 0);
  console.log(
    "Questions with images:",
    withImages.map((q) => ({ content: q.content_latex.slice(0, 40), images: q.image_urls }))
  );

  for (const [name, buf] of images) {
    writeFileSync(`scripts/out_${name}`, buf);
  }
  console.log("Saved crops to scripts/out_*.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
