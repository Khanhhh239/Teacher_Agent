import { checkAgainstLayer, diffReads, normalizeReadResult, structureProblems, describeLayerCheck } from "../src/lib/extraction/questionChecks";

let failed = 0;
const t = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " -> " + extra : ""}`);
  if (!cond) failed++;
};
const mk = (content: string, subs: string[] = []) =>
  normalizeReadResult({
    type: subs.length ? "true_false_group" : "short_answer",
    content_latex: content,
    sub_statements: subs.map((x, i) => ({ key: "abcd"[i], text_latex: x })),
  });

// Lớp chữ gốc (công thức vỡ như thực tế: "( )" mất nội dung)
const layer20 = "Câu 20. Kiến trúc sư thiết kế một khu sinh hoạt cộng đồng có dạng hình chữ nhật. Diện tích sân chơi bằng 3200 mét vuông.";
const good = mk("Kiến trúc sư thiết kế một khu sinh hoạt cộng đồng có dạng hình chữ nhật. Diện tích sân chơi bằng $3200$ mét vuông.");
const dropped = mk("Kiến sư thiết kế một khu sinh hoạt cộng đồng có dạng hình chữ nhật. Diện tích sân chơi bằng $3200$ mét vuông.");

t("faithful read: no layer issues", checkAgainstLayer(good, layer20).score === 0, JSON.stringify(checkAgainstLayer(good, layer20)));
const d = checkAgainstLayer(dropped, layer20);
t("dropped word 'trúc' detected", d.missingWords.includes("trúc"), JSON.stringify(d));
t("dropped read scores worse than faithful one (arbiter picks faithful)", d.score > checkAgainstLayer(good, layer20).score);

// Dấu tiếng Việt sai: vecto vs vectơ
const layer4 = "Câu 4. Phương trình đường thẳng đi qua điểm và có một vectơ chỉ phương là";
const vecto = mk("Phương trình đường thẳng đi qua điểm và có một vecto chỉ phương là");
t("diacritic variant 'vecto' vs layer 'vectơ' -> ambiguous pair, scores worse than the faithful read",
  checkAgainstLayer(vecto, layer4).ambiguousPairs.length === 1 &&
  checkAgainstLayer(vecto, layer4).score > checkAgainstLayer(mk("Phương trình đường thẳng đi qua điểm và có một vectơ chỉ phương là"), layer4).score);
t("ambiguous pair only reported when reads disagree", describeLayerCheck(checkAgainstLayer(vecto, layer4)).length === 0 && describeLayerCheck(checkAgainstLayer(vecto, layer4), true).length === 1);
t("correct 'vectơ' passes", checkAgainstLayer(mk("Phương trình đường thẳng đi qua điểm và có một vectơ chỉ phương là"), layer4).score === 0);

// Chữ số sai: 7500000 vs 700000
// Lớp chữ thật của đề mẫu: dòng bị ngắt giữa "7" và "500000" (hai khoảng trắng sau khi nối dòng)
const layer16 = "Các thiên thạch có đường kính lớn hơn 140m và có khoảng cách nhỏ hơn 7  500000 km được coi là những vật thể nguy hiểm";
const right = mk("Các thiên thạch có đường kính lớn hơn $140m$ và có khoảng cách nhỏ hơn $7500000$ km được coi là những vật thể nguy hiểm");
const wrong = mk("Các thiên thạch có đường kính lớn hơn $140m$ và có khoảng cách nhỏ hơn $700000$ km được coi là những vật thể nguy hiểm");
t("line-wrapped layer number ('7  500000') matches read 7500000", checkAgainstLayer(right, layer16).numberMismatches.length === 0, JSON.stringify(checkAgainstLayer(right, layer16)));
const thin = mk("Các thiên thạch có đường kính lớn hơn $140m$ và có khoảng cách nhỏ hơn $7\,500\,000$ km được coi là những vật thể nguy hiểm");
t("read written 7\,500\,000 also matches", checkAgainstLayer(thin, layer16).numberMismatches.length === 0, JSON.stringify(checkAgainstLayer(thin, layer16).numberMismatches));
t("wrong digit count 700000 still flagged", checkAgainstLayer(wrong, layer16).numberMismatches.length >= 1, JSON.stringify(checkAgainstLayer(wrong, layer16).numberMismatches));
t("describeLayerCheck produces readable lines", describeLayerCheck(checkAgainstLayer(wrong, layer16)).some((l) => l.includes("Số lệch")));

// Ký tự rác mũi tên véc-tơ trong lớp chữ không gây cờ giả
t("vector-arrow glyph noise (uuur) ignored", checkAgainstLayer(mk("Cho hai véc-tơ $\overrightarrow{AB}$ và $\overrightarrow{AC}$"), "Câu 7. Cho hai véc-tơ uuur AB và uuur AC").missingWords.includes("uuur") === false);
// Lỗi của chính lớp chữ ("iượt" thay "lượt") khi hai lần đọc đồng ý -> không báo
const gl = checkAgainstLayer(mk("Số lượt chơi là một"), "Số iượt chơi là một");
t("layer's own glitch (iượt) lands in ambiguous pairs, not wrong/missing", gl.ambiguousPairs.length === 1 && gl.wrongWords.length === 0 && gl.missingWords.length === 0, JSON.stringify(gl));

// Công thức vỡ trong lớp chữ KHÔNG gây cờ giả
const layerF = "Câu 2. Cho hàm số liên tục, nhận giá trị dương trên đoạn . Xét hình phẳng giới hạn bởi đồ thị hàm số";
const withFormula = mk("Cho hàm số $y=f(x)$ liên tục, nhận giá trị dương trên đoạn $[a;b]$. Xét hình phẳng $(H)$ giới hạn bởi đồ thị hàm số $y=f(x)$");
t("formulas missing from layer do not create false flags", checkAgainstLayer(withFormula, layerF).score === 0, JSON.stringify(checkAgainstLayer(withFormula, layerF)));

// Chuẩn hóa mới
t("70\\% == 70%", diffReads(mk("Có $70\\%$ người"), mk("Có $70%$ người")).length === 0);
t("\\mid == |", diffReads(mk("$P(A\\mid B)=0,3$"), mk("$P(A|B)=0,3$")).length === 0);
t("figure count no longer a content disagreement", diffReads(normalizeReadResult({ type: "short_answer", content_latex: "x", figure_boxes: [{ bbox_1000: [0, 0, 10, 10] }] }), mk("x")).length === 0);
t("bare 'đồ thị hàm số' (no figure) is NOT flagged as missing figure", !structureProblems(mk("Xét hình phẳng giới hạn bởi đồ thị hàm số y = f(x)")).some((m) => m.includes("hình")));
t("'như hình vẽ bên' without figure IS flagged", structureProblems(mk("Cho hàm số có đồ thị như hình vẽ bên")).some((m) => m.includes("hình")));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
