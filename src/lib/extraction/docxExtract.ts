import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { convertOMath } from "./omml2latex";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const V_NS = "urn:schemas-microsoft-com:vml";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

export type DocxBranch = "OMML_NATIVE" | "LEGACY_OLE_IMAGE" | "NO_MATH_DETECTED";

export interface DocxExtractResult {
  text: string;
  images: Map<string, Buffer>; // filename -> ảnh minh họa thật (w:drawing)
  warnings: string[];
  branch: DocxBranch;
}

function localName(node: Element): string {
  return node.localName ?? node.nodeName.split(":").pop() ?? "";
}

function loadRelationships(relsXml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml) return map;
  const doc = new DOMParser().parseFromString(relsXml, "text/xml");
  const rels = doc.getElementsByTagNameNS(REL_NS, "Relationship");
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    map.set(rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? "");
  }
  return map;
}

export async function detectDocxBranch(buf: Buffer): Promise<DocxBranch> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "NO_MATH_DETECTED";
  const hasOmml = xml.includes("<m:oMath");
  const hasOle = xml.includes("<w:object");
  if (hasOle) return "LEGACY_OLE_IMAGE";
  if (hasOmml) return "OMML_NATIVE";
  return "NO_MATH_DETECTED";
}

export async function extractDocx(buf: Buffer): Promise<DocxExtractResult> {
  const zip = await JSZip.loadAsync(buf);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("File .docx không hợp lệ: thiếu word/document.xml");

  const relsXml = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? null;
  const rels = loadRelationships(relsXml);

  const branch = documentXml.includes("<w:object")
    ? "LEGACY_OLE_IMAGE"
    : documentXml.includes("<m:oMath")
      ? "OMML_NATIVE"
      : "NO_MATH_DETECTED";

  const doc = new DOMParser().parseFromString(documentXml, "text/xml");
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];

  const images = new Map<string, Buffer>();
  const warnings: string[] = [];
  const textParts: string[] = [];
  let equationCounter = 0;
  let imageCounter = 0;

  // Đánh dấu m:oMath nằm trong m:oMathPara để tránh xử lý 2 lần
  const skipOMath = new Set<Element>();
  const oMathParas = body.getElementsByTagNameNS(M_NS, "oMathPara");
  for (let i = 0; i < oMathParas.length; i++) {
    const inner = oMathParas[i].getElementsByTagNameNS(M_NS, "oMath");
    for (let j = 0; j < inner.length; j++) skipOMath.add(inner[j]);
  }

  async function resolveMedia(target: string): Promise<Buffer | null> {
    const mediaPath = target.startsWith("word/") ? target : `word/${target}`;
    const file = zip.file(mediaPath);
    if (!file) return null;
    return file.async("nodebuffer");
  }

  async function walk(node: Element): Promise<void> {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType !== 1) continue;
      const el = child as unknown as Element;
      const local = localName(el);
      const ns = el.namespaceURI;

      if (ns === W_NS && local === "t") {
        // Loại trừ w:t nằm trong m:oMath (không nên xảy ra do khác namespace, nhưng phòng hờ)
        textParts.push(el.textContent ?? "");
      } else if (ns === M_NS && (local === "oMathPara" || (local === "oMath" && !skipOMath.has(el)))) {
        const latex = convertOMath(el);
        textParts.push(` $${latex}$ `);
      } else if (ns === W_NS && local === "object") {
        equationCounter++;
        const imagedataList = el.getElementsByTagNameNS(V_NS, "imagedata");
        let handled = false;
        if (imagedataList.length > 0) {
          const rId = imagedataList[0].getAttributeNS(R_NS, "id");
          const target = rId ? rels.get(rId) : null;
          if (target) {
            const wmfBuf = await resolveMedia(target);
            if (wmfBuf) {
              textParts.push(` [CÔNG THỨC CHƯA NHẬN DẠNG #${equationCounter} — công thức MathType cũ, cần giáo viên nhập tay LaTeX hoặc xuất file thành PDF rồi tải lại để hệ thống tự OCR] `);
              warnings.push(
                `Công thức ${equationCounter} là ảnh MathType cũ (WMF) — hệ thống web chưa tự OCR được loại này. Khuyến nghị: mở file này trong Word, chọn "Save As" → PDF, rồi tải file PDF lên thay vì file Word.`
              );
              handled = true;
            }
          }
        }
        if (!handled) {
          textParts.push(` [CÔNG THỨC KHÔNG XÁC ĐỊNH #${equationCounter}] `);
        }
      } else if (ns === W_NS && local === "drawing") {
        const blips = el.getElementsByTagNameNS(A_NS, "blip");
        if (blips.length > 0) {
          const rId = blips[0].getAttributeNS(R_NS, "embed");
          const target = rId ? rels.get(rId) : null;
          if (target) {
            const imgBuf = await resolveMedia(target);
            if (imgBuf) {
              imageCounter++;
              const ext = target.includes(".") ? target.split(".").pop() : "png";
              const fname = `figure_${imageCounter}.${ext}`;
              images.set(fname, imgBuf);
              textParts.push(` [IMAGE:${fname}] `);
            }
          }
        }
      } else {
        await walk(el);
        if (ns === W_NS && local === "p") textParts.push("\n");
      }
    }
  }

  const paragraphs = body.getElementsByTagNameNS(W_NS, "p");
  // Duyệt trực tiếp children của body theo thứ tự thay vì getElementsByTagName (không giữ thứ tự lồng bảng đúng)
  await walk(body);
  void paragraphs;

  return { text: textParts.join(""), images, warnings, branch };
}
