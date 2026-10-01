/**
 * Convert OMML (Office Math Markup Language, <m:oMath>) sang LaTeX.
 * Port TypeScript của pipeline/omml2latex.py — chạy được trong Vercel serverless
 * function (không cần Python/LibreOffice). Bao phủ các cấu trúc phổ biến trong đề
 * thi Toán/Lý/Hóa tiếng Việt: phân số, lũy thừa, chỉ số dưới, căn, tích phân/tổng,
 * vecto (accent mũi tên), gạch ngang (bar), ma trận, ngoặc tự co giãn, giới hạn.
 * Không phủ 100% mọi cấu trúc OMML — phần không nhận diện được fallback về text thô.
 */

import type { Element } from "@xmldom/xmldom";

const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

function localName(node: Element): string {
  return node.localName ?? node.nodeName.split(":").pop() ?? "";
}

function children(el: Element, tag: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1 && localName(n as unknown as Element) === tag) {
      out.push(n as unknown as Element);
    }
  }
  return out;
}

function first(el: Element, tag: string): Element | null {
  return children(el, tag)[0] ?? null;
}

function attrVal(el: Element, tag: string): string | null {
  const sub = first(el, tag);
  if (!sub) return null;
  return sub.getAttributeNS(M_NS, "val") || sub.getAttribute("m:val") || sub.getAttribute("val");
}

function textOfRun(r: Element): string {
  let out = "";
  for (let i = 0; i < r.childNodes.length; i++) {
    const n = r.childNodes[i];
    if (n.nodeType === 1 && localName(n as unknown as Element) === "t") {
      out += n.textContent ?? "";
    }
  }
  return out;
}

const ACCENT_LATEX: Record<string, string> = {
  "\u2192": "vec",
  "\u20d7": "vec", // COMBINING RIGHT ARROW ABOVE \u2014 m\u00e3 th\u1ef1c t\u1ebf Word/MathType d\u00f9ng cho vect\u01a1 (m:chr trong OMML), kh\u00f4ng ph\u1ea3i U+2192
  "\u203e": "overline", // OVERLINE \u2014 d\u00f9ng cho \u0111o\u1ea1n th\u1eb3ng/gi\u00e1 tr\u1ecb trung b\u00ecnh, tr\u01b0\u1edbc \u0111\u00e2y b\u1ecb fallback nh\u1ea7m th\u00e0nh vec
  "\u0302": "hat",
  "\u0303": "tilde",
  "\u0304": "bar",
};

const NARY_CHR_MAP: Record<string, string> = {
  "\u2211": "\\sum",
  "\u220f": "\\prod",
  "\u222b": "\\int",
  "\u222c": "\\iint",
  "\u222d": "\\iiint",
  "\u22c3": "\\bigcup",
  "\u22c2": "\\bigcap",
};

const DELIM_LATEX: Record<string, [string, string]> = {
  "(": ["\\left(", ""],
  "[": ["\\left[", ""],
  "{": ["\\left\\{", ""],
  "|": ["\\left|", ""],
  "": ["\\left(", ""],
};
const DELIM_END_LATEX: Record<string, string> = {
  ")": "\\right)",
  "]": "\\right]",
  "}": "\\right\\}",
  "|": "\\right|",
  "": "\\right)",
};

function convertChildren(el: Element): string {
  let out = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1) out += convertNode(n as unknown as Element);
  }
  return out;
}

function convertNode(el: Element): string {
  const local = localName(el);
  switch (local) {
    case "r":
      return escapeLatexText(textOfRun(el));
    case "f": {
      const num = first(el, "num");
      const den = first(el, "den");
      return `\\frac{${num ? convertChildren(num) : ""}}{${den ? convertChildren(den) : ""}}`;
    }
    case "sSup": {
      const base = first(el, "e");
      const sup = first(el, "sup");
      return `{${base ? convertChildren(base) : ""}}^{${sup ? convertChildren(sup) : ""}}`;
    }
    case "sSub": {
      const base = first(el, "e");
      const sub = first(el, "sub");
      return `{${base ? convertChildren(base) : ""}}_{${sub ? convertChildren(sub) : ""}}`;
    }
    case "sSubSup": {
      const base = first(el, "e");
      const sub = first(el, "sub");
      const sup = first(el, "sup");
      return `{${base ? convertChildren(base) : ""}}_{${sub ? convertChildren(sub) : ""}}^{${sup ? convertChildren(sup) : ""}}`;
    }
    case "rad": {
      const deg = first(el, "deg");
      const base = first(el, "e");
      const degText = deg ? convertChildren(deg) : "";
      const baseText = base ? convertChildren(base) : "";
      return degText.trim() ? `\\sqrt[${degText}]{${baseText}}` : `\\sqrt{${baseText}}`;
    }
    case "nary": {
      const naryPr = first(el, "naryPr");
      const chrVal = naryPr ? attrVal(naryPr, "chr") : null;
      const symbol = (chrVal && NARY_CHR_MAP[chrVal]) || "\\sum";
      const sub = first(el, "sub");
      const sup = first(el, "sup");
      const base = first(el, "e");
      const lo = sub ? convertChildren(sub) : "";
      const hi = sup ? convertChildren(sup) : "";
      const body = base ? convertChildren(base) : "";
      let result = symbol;
      if (lo) result += `_{${lo}}`;
      if (hi) result += `^{${hi}}`;
      return `${result} ${body}`;
    }
    case "acc": {
      const accPr = first(el, "accPr");
      const chrVal = accPr ? attrVal(accPr, "chr") : null;
      const base = first(el, "e");
      const baseText = base ? convertChildren(base) : "";
      // Theo spec OOXML, khi <m:acc> không có m:chr (Word bỏ qua khi dùng mẫu accent mặc định
      // trong gallery công thức), ký tự mặc định là circumflex (hat) — ví dụ điển hình: ký hiệu
      // góc "ABC" ($\widehat{ABC}$) không set m:chr vì hat là default, TRƯỚC ĐÂY bị fallback
      // nhầm thành "vec" khiến góc hiển thị thành vectơ. "vec" chỉ nên áp dụng khi m:chr khớp
      // rõ ràng trong ACCENT_LATEX (ví dụ U+20D7).
      const cmd = (chrVal && ACCENT_LATEX[chrVal]) || "hat";
      // \hat chỉ đẹp với 1 ký tự; accent phủ nhiều ký tự (vd "ABC") cần \widehat để co giãn
      // đúng bề rộng — áp dụng cho mọi loại accent có base nhiều ký tự, trừ vec (vectơ nhiều
      // chữ như $\vec{BA}$ vẫn dùng \vec bình thường theo quy ước đề thi).
      const wideCmd = cmd === "hat" && baseText.length > 1 ? "widehat" : cmd;
      return `\\${wideCmd}{${baseText}}`;
    }
    case "bar": {
      const barPr = first(el, "barPr");
      const pos = (barPr && attrVal(barPr, "pos")) || "top";
      const base = first(el, "e");
      const baseText = base ? convertChildren(base) : "";
      return pos === "top" ? `\\overline{${baseText}}` : `\\underline{${baseText}}`;
    }
    case "d": {
      const dPr = first(el, "dPr");
      const begChr = (dPr && attrVal(dPr, "begChr")) ?? "(";
      const endChr = (dPr && attrVal(dPr, "endChr")) ?? ")";
      const left = (DELIM_LATEX[begChr] ?? DELIM_LATEX[""])[0];
      const right = DELIM_END_LATEX[endChr] ?? DELIM_END_LATEX[""];
      const inner = children(el, "e").map(convertChildren).join(",");
      return `${left}${inner}${right}`;
    }
    case "m": {
      const rows = children(el, "mr").map((mr) => children(mr, "e").map(convertChildren).join(" & "));
      return `\\begin{pmatrix}${rows.join(" \\\\ ")}\\end{pmatrix}`;
    }
    case "limLow":
    case "limUpp": {
      const base = first(el, "e");
      const lim = first(el, "lim");
      return `${base ? convertChildren(base) : ""}_{${lim ? convertChildren(lim) : ""}}`;
    }
    case "func": {
      const fName = first(el, "fName");
      const base = first(el, "e");
      return `${fName ? convertChildren(fName) : ""}{${base ? convertChildren(base) : ""}}`;
    }
    case "oMath":
    case "e":
    case "num":
    case "den":
      return convertChildren(el);
    default: {
      if (el.childNodes.length > 0) return convertChildren(el);
      return el.textContent ?? "";
    }
  }
}

function escapeLatexText(text: string): string {
  return text.replace(/%/g, "\\%").replace(/&/g, "\\&").replace(/_/g, "\\_").replace(/#/g, "\\#");
}

export function convertOMath(node: Element): string {
  return convertChildren(node).trim();
}
