"""Convert OMML (Office Math Markup Language, <m:oMath>) sang chuỗi LaTeX.

Không dùng thư viện ngoài (Pandoc thường không có sẵn trên máy giáo viên) — tự viết
recursive transformer bằng lxml, bao phủ các cấu trúc phổ biến trong đề thi Toán/Lý/Hóa
tiếng Việt: phân số, lũy thừa, chỉ số dưới, căn, tích phân/tổng/tích (nary), vecto (accent
mũi tên), gạch ngang vecto AB (bar), ma trận, dấu ngoặc tự động co giãn, giới hạn.

Không phủ 100% mọi cấu trúc OMML (vd: box, eqArr lồng nhau phức tạp) — phần không nhận
diện được sẽ fallback về text thô, kèm cảnh báo trong raw_ocr_notes để giáo viên rà soát
tại bước Review UI.
"""

from __future__ import annotations

from lxml import etree

M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"


def _local(tag: str) -> str:
    return etree.QName(tag).localname if "}" in tag else tag


def _text_of_run(r: etree._Element) -> str:
    return "".join(t.text or "" for t in r.findall(f"{M}t"))


def _children(e: etree._Element, tag: str):
    return e.findall(f"{M}{tag}")


def _first(e: etree._Element, tag: str):
    return e.find(f"{M}{tag}")


# Ký tự accent thường gặp trong OMML cho vecto/mũ
ACCENT_LATEX = {
    "→": "vec",   # →  COMBINING RIGHT ARROW ABOVE (\vec{u})
    "̂": "hat",   # ̂
    "̃": "tilde",
    "̄": "bar",   # ̄  (đôi khi dùng cho gạch ngang thay vì m:bar)
}


def convert_omath(node: etree._Element) -> str:
    """Chuyển 1 node <m:oMath> hoặc <m:oMathPara> sang LaTeX."""
    parts = [_convert_node(child) for child in node if _local(child.tag) != "oMathParaPr"]
    return "".join(parts).strip()


def _convert_node(e: etree._Element) -> str:
    tag = _local(e.tag)
    handler = _HANDLERS.get(tag)
    if handler:
        return handler(e)
    # Node không nhận diện được: cố gắng đệ quy vào con, fallback lấy text thô
    children = list(e)
    if children:
        return "".join(_convert_node(c) for c in children)
    return e.text or ""


def _convert_children(e: etree._Element) -> str:
    return "".join(_convert_node(c) for c in e)


def _h_r(e: etree._Element) -> str:
    """m:r — 1 run văn bản/ký hiệu toán."""
    text = _text_of_run(e)
    # Escape các ký tự đặc biệt LaTeX xuất hiện trong text thường
    for ch, esc in [("%", r"\%"), ("&", r"\&"), ("_", r"\_"), ("#", r"\#")]:
        text = text.replace(ch, esc)
    return text


def _h_f(e: etree._Element) -> str:
    """m:f — phân số."""
    num = _first(e, "num")
    den = _first(e, "den")
    return f"\\frac{{{_convert_children(num) if num is not None else ''}}}{{{_convert_children(den) if den is not None else ''}}}"


def _h_sSup(e: etree._Element) -> str:
    base = _first(e, "e")
    sup = _first(e, "sup")
    return f"{{{_convert_children(base) if base is not None else ''}}}^{{{_convert_children(sup) if sup is not None else ''}}}"


def _h_sSub(e: etree._Element) -> str:
    base = _first(e, "e")
    sub = _first(e, "sub")
    return f"{{{_convert_children(base) if base is not None else ''}}}_{{{_convert_children(sub) if sub is not None else ''}}}"


def _h_sSubSup(e: etree._Element) -> str:
    base = _first(e, "e")
    sub = _first(e, "sub")
    sup = _first(e, "sup")
    b = _convert_children(base) if base is not None else ""
    lo = _convert_children(sub) if sub is not None else ""
    hi = _convert_children(sup) if sup is not None else ""
    return f"{{{b}}}_{{{lo}}}^{{{hi}}}"


def _h_rad(e: etree._Element) -> str:
    """m:rad — căn bậc n (mặc định bậc 2)."""
    deg = _first(e, "deg")
    base = _first(e, "e")
    deg_text = _convert_children(deg) if deg is not None else ""
    base_text = _convert_children(base) if base is not None else ""
    if deg_text.strip():
        return f"\\sqrt[{deg_text}]{{{base_text}}}"
    return f"\\sqrt{{{base_text}}}"


NARY_CHR_MAP = {
    "∑": r"\sum",
    "∏": r"\prod",
    "∫": r"\int",
    "∬": r"\iint",
    "∭": r"\iiint",
    "⋃": r"\bigcup",
    "⋂": r"\bigcap",
}


def _h_nary(e: etree._Element) -> str:
    """m:nary — toán tử n-ary: tổng, tích, tích phân."""
    naryPr = _first(e, "naryPr")
    chr_val = None
    if naryPr is not None:
        chr_el = _first(naryPr, "chr")
        if chr_el is not None:
            chr_val = chr_el.get(f"{M}val")
    symbol = NARY_CHR_MAP.get(chr_val, r"\sum")

    sub = _first(e, "sub")
    sup = _first(e, "sup")
    base = _first(e, "e")

    lo = _convert_children(sub) if sub is not None else ""
    hi = _convert_children(sup) if sup is not None else ""
    body = _convert_children(base) if base is not None else ""

    result = symbol
    if lo:
        result += f"_{{{lo}}}"
    if hi:
        result += f"^{{{hi}}}"
    return f"{result} {body}"


def _h_acc(e: etree._Element) -> str:
    """m:acc — dấu accent phía trên (vecto \\vec{u}, mũ \\hat{x}...)."""
    accPr = _first(e, "accPr")
    chr_val = None
    if accPr is not None:
        chr_el = _first(accPr, "chr")
        if chr_el is not None:
            chr_val = chr_el.get(f"{M}val")
    base = _first(e, "e")
    base_text = _convert_children(base) if base is not None else ""
    latex_cmd = ACCENT_LATEX.get(chr_val, "vec")
    return f"\\{latex_cmd}{{{base_text}}}"


def _h_bar(e: etree._Element) -> str:
    """m:bar — gạch ngang trên/dưới (thường dùng cho đoạn thẳng \\overline{AB})."""
    barPr = _first(e, "barPr")
    pos = "top"
    if barPr is not None:
        pos_el = _first(barPr, "pos")
        if pos_el is not None:
            pos = pos_el.get(f"{M}val", "top")
    base = _first(e, "e")
    base_text = _convert_children(base) if base is not None else ""
    return f"\\overline{{{base_text}}}" if pos == "top" else f"\\underline{{{base_text}}}"


DELIM_CHR_LATEX = {
    "(": (r"\left(", r"\right)"),
    "[": (r"\left[", r"\right]"),
    "{": (r"\left\{", r"\right\}"),
    "|": (r"\left|", r"\right|"),
    "": (r"\left(", r"\right)"),
}


def _h_d(e: etree._Element) -> str:
    """m:d — dấu ngoặc tự động co giãn."""
    dPr = _first(e, "dPr")
    beg_chr, end_chr = "(", ")"
    if dPr is not None:
        beg_el = _first(dPr, "begChr")
        end_el = _first(dPr, "endChr")
        if beg_el is not None:
            beg_chr = beg_el.get(f"{M}val", "(")
        if end_el is not None:
            end_chr = end_el.get(f"{M}val", ")")

    left_latex = DELIM_CHR_LATEX.get(beg_chr, (r"\left(",))[0]
    right_latex = DELIM_CHR_LATEX.get(end_chr, (None, r"\right)"))[1]

    inner_parts = [_convert_children(el) for el in _children(e, "e")]
    inner = ",".join(inner_parts)
    return f"{left_latex}{inner}{right_latex}"


def _h_m(e: etree._Element) -> str:
    """m:m — ma trận."""
    rows = []
    for mr in _children(e, "mr"):
        cells = [_convert_children(el) for el in _children(mr, "e")]
        rows.append(" & ".join(cells))
    body = " \\\\ ".join(rows)
    return f"\\begin{{pmatrix}}{body}\\end{{pmatrix}}"


def _h_limLow(e: etree._Element) -> str:
    base = _first(e, "e")
    lim = _first(e, "lim")
    base_text = _convert_children(base) if base is not None else ""
    lim_text = _convert_children(lim) if lim is not None else ""
    return f"{base_text}_{{{lim_text}}}"


def _h_func(e: etree._Element) -> str:
    fName = _first(e, "fName")
    base = _first(e, "e")
    name_text = _convert_children(fName) if fName is not None else ""
    base_text = _convert_children(base) if base is not None else ""
    return f"{name_text}{{{base_text}}}"


def _h_pass_through(e: etree._Element) -> str:
    return _convert_children(e)


_HANDLERS = {
    "r": _h_r,
    "f": _h_f,
    "sSup": _h_sSup,
    "sSub": _h_sSub,
    "sSubSup": _h_sSubSup,
    "rad": _h_rad,
    "nary": _h_nary,
    "acc": _h_acc,
    "bar": _h_bar,
    "d": _h_d,
    "m": _h_m,
    "limLow": _h_limLow,
    "limUpp": _h_limLow,
    "func": _h_func,
    # Nhóm bao ngoài — đệ quy thẳng vào con
    "oMath": _h_pass_through,
    "e": _h_pass_through,
    "num": _h_pass_through,
    "den": _h_pass_through,
}


def extract_all_omath(document_xml_bytes: bytes) -> list[str]:
    """Trích toàn bộ <m:oMath>/<m:oMathPara> trong document.xml, trả về danh sách LaTeX
    theo đúng thứ tự xuất hiện (duyệt document-order, không lặp lại oMath lồng trong oMathPara)."""
    root = etree.fromstring(document_xml_bytes)
    results = []
    skip_ids = set()

    for node in root.iter(f"{M}oMathPara"):
        for inner in node.findall(f"{M}oMath"):
            skip_ids.add(id(inner))

    for node in root.iter():
        local = _local(node.tag)
        if local == "oMathPara":
            results.append(convert_omath(node))
        elif local == "oMath" and id(node) not in skip_ids:
            results.append(convert_omath(node))

    return results
