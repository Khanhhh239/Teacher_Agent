import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/GEMINI_API_KEY=(.+)/)[1].trim();
const pdfBuf = fs.readFileSync(process.argv[2]);
const b64 = pdfBuf.toString("base64");

const start = Date.now();
fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: "application/pdf", data: b64 } },
            { text: "Liet ke so luong cau hoi trong de thi nay, chi tra loi 1 so." },
          ],
        },
      ],
    }),
  }
)
  .then((r) => r.json())
  .then((d) => {
    console.log("took ms", Date.now() - start);
    console.log(JSON.stringify(d).slice(0, 500));
  })
  .catch((e) => console.error("ERR", Date.now() - start, e));
