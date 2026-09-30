"""Bước 0 + Nhánh A/B: phát hiện loại công thức trong .docx và trích xuất thành 1 luồng
văn bản thuần xen kẽ LaTeX ($...$) và marker ảnh, giữ đúng thứ tự xuất hiện trong tài liệu.

- OMML native (<m:oMath>) -> convert trực tiếp bằng omml2latex.py, không tốn AI.
- OLE/WMF equation cũ (<w:object>) -> cần LibreOffice (convert WMF->PNG) + Gemini vision OCR.
  Nếu thiếu LibreOffice, chèn placeholder + lưu ảnh gốc để giáo viên tự nhập tay.
- <w:drawing> thường -> ảnh minh họa thật, lưu ra output/images/, chèn marker [IMAGE:tên_file].
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

from omml2latex import convert_omath, _local  # type: ignore

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
M = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
V = "urn:schemas-microsoft-com:vml"
O = "urn:schemas-microsoft-com:office:office"


def detect_branch(docx_path: str) -> str:
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read("word/document.xml")
    has_omml = b"<m:oMath" in xml
    has_ole = b"<w:object" in xml
    if has_omml and not has_ole:
        return "OMML_NATIVE"
    if has_ole:
        return "LEGACY_OLE_IMAGE"
    return "OMML_NATIVE" if has_omml else "NO_MATH_DETECTED"


def _load_relationships(z: zipfile.ZipFile, part: str) -> dict[str, str]:
    rels_path = f"{os.path.dirname(part)}/_rels/{os.path.basename(part)}.rels"
    if rels_path not in z.namelist():
        return {}
    rels_xml = etree.fromstring(z.read(rels_path))
    return {
        rel.get("Id"): rel.get("Target")
        for rel in rels_xml.iter("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship")
    }


def _is_libreoffice_available() -> bool:
    return shutil.which("soffice") is not None or shutil.which("libreoffice") is not None


def _convert_wmf_to_png(wmf_bytes: bytes, out_path: str) -> bool:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return False
    with tempfile.TemporaryDirectory() as tmp:
        wmf_path = os.path.join(tmp, "eq.wmf")
        with open(wmf_path, "wb") as f:
            f.write(wmf_bytes)
        subprocess.run(
            [soffice, "--headless", "--convert-to", "png", "--outdir", tmp, wmf_path],
            check=True,
            timeout=60,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        produced = os.path.join(tmp, "eq.png")
        if os.path.exists(produced):
            shutil.copy(produced, out_path)
            return True
    return False


def extract_docx(docx_path: str, output_dir: str, ocr_ole_equations: bool = True) -> dict:
    """Trả về {"text": str, "warnings": list[str]}. Ảnh được lưu vào output_dir/images/."""
    images_dir = Path(output_dir) / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []

    with zipfile.ZipFile(docx_path) as z:
        document_xml = z.read("word/document.xml")
        rels = _load_relationships(z, "word/document.xml")
        root = etree.fromstring(document_xml)
        body = root.find(f"{W}body")

        # Đánh dấu các m:oMath nằm trong m:oMathPara để tránh xử lý 2 lần
        skip_omath_ids = set()
        for para in root.iter(f"{M}oMathPara"):
            for inner in para.findall(f"{M}oMath"):
                skip_omath_ids.add(id(inner))

        text_parts: list[str] = []
        equation_counter = 0
        image_counter = 0

        def handle_paragraph(p: etree._Element):
            nonlocal equation_counter, image_counter
            for node in p.iter():
                local = _local(node.tag)

                if node.tag == f"{W}t":
                    # w:t (namespace word, KHÔNG phải m:t bên trong công thức) — text thường.
                    # Bỏ qua nếu tổ tiên là oMath/oMathPara (đã được convert_omath xử lý riêng).
                    ancestor_tags = {a.tag for a in node.iterancestors()}
                    if f"{M}oMath" not in ancestor_tags and f"{M}oMathPara" not in ancestor_tags:
                        text_parts.append(node.text or "")

                elif local == "oMathPara":
                    latex = convert_omath(node)
                    text_parts.append(f" ${latex}$ ")

                elif local == "oMath" and id(node) not in skip_omath_ids:
                    if node.getparent() is not None and _local(node.getparent().tag) == "oMathPara":
                        continue
                    latex = convert_omath(node)
                    text_parts.append(f" ${latex}$ ")

                elif local == "object":
                    equation_counter += 1
                    handled = False
                    imagedata = node.find(f".//{{{V}}}imagedata")
                    if imagedata is not None:
                        r_id = imagedata.get(f"{R}id")
                        target = rels.get(r_id)
                        if target:
                            media_path = f"word/{target}" if not target.startswith("word/") else target
                            try:
                                wmf_bytes = z.read(media_path)
                            except KeyError:
                                wmf_bytes = None
                            if wmf_bytes and ocr_ole_equations and _is_libreoffice_available():
                                png_path = images_dir / f"equation_{equation_counter}.png"
                                if _convert_wmf_to_png(wmf_bytes, str(png_path)):
                                    try:
                                        from llm_client import ocr_equation_image

                                        latex = ocr_equation_image(str(png_path))
                                        text_parts.append(f" ${latex}$ ")
                                        handled = True
                                    except Exception as e:  # noqa: BLE001
                                        warnings.append(f"OCR công thức {equation_counter} lỗi: {e}")
                            if not handled and wmf_bytes:
                                raw_path = images_dir / f"equation_{equation_counter}_raw{Path(media_path).suffix}"
                                raw_path.write_bytes(wmf_bytes)
                                text_parts.append(
                                    f" [CÔNG THỨC CHƯA NHẬN DẠNG - xem {raw_path.name}] "
                                )
                                warnings.append(
                                    f"Công thức {equation_counter} là ảnh WMF cũ (MathType), "
                                    f"cần LibreOffice để OCR tự động. Đã lưu ảnh gốc để nhập tay."
                                )

                elif local == "drawing":
                    blip = node.find(f".//{{http://schemas.openxmlformats.org/drawingml/2006/main}}blip")
                    if blip is not None:
                        r_id = blip.get(f"{R}embed")
                        target = rels.get(r_id)
                        if target:
                            media_path = f"word/{target}" if not target.startswith("word/") else target
                            try:
                                img_bytes = z.read(media_path)
                            except KeyError:
                                img_bytes = None
                            if img_bytes:
                                image_counter += 1
                                ext = Path(media_path).suffix or ".png"
                                fname = f"figure_{image_counter}{ext}"
                                (images_dir / fname).write_bytes(img_bytes)
                                text_parts.append(f" [IMAGE:{fname}] ")

            text_parts.append("\n")

        for p in body.iter(f"{W}p"):
            # Chỉ xử lý các <w:p> con trực tiếp/lồng bình thường của body (bỏ qua p trong footnote riêng)
            handle_paragraph(p)

    full_text = "".join(text_parts)
    return {"text": full_text, "warnings": warnings}
