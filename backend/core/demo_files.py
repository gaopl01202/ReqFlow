"""Synthetic dashboard image and uploaded-document fixtures for development scenarios."""

import csv
import io
import random
import struct
import zipfile
import zlib
from xml.sax.saxutils import escape

from django.conf import settings

MODULES = ["账号与权限", "业务流程", "数据报表", "消息通知", "移动端", "系统集成"]


def preview_image(seed):
    """Small synthetic dashboard screenshot, containing no real user data."""
    rng = random.Random(seed)
    width, height = 640, 300
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            color = (245, 247, 250)
            if y < 36:
                color = (39, 64, 96)
            elif x < 112:
                color = (228, 234, 242)
            elif 130 < x < 620 and 52 < y < 115:
                color = (255, 255, 255)
            elif 130 < x < 620 and 135 < y < 275:
                color = (255, 255, 255)
                if 160 < x < 590 and 160 < y < 250 and x % 65 < 32 and y > 180 + (x // 65 % 4) * 14:
                    color = (50, 125, 220)
            row.extend(color)
        rows.append(b"\x00" + row)

    def chunk(kind, data):
        return (
            struct.pack("!I", len(data))
            + kind
            + data
            + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    # Seed changes metadata without altering the predictable illustrative layout.
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack("!2I5B", width, height, 8, 2, 0, 0, 0))
        + chunk(b"tEXt", f"Scenario\x00{rng.randrange(100000)}".encode())
        + chunk(b"IDAT", zlib.compress(b"".join(rows)))
        + chunk(b"IEND", b"")
    )


def document_payload(kind, project, topic, index):
    text = f"{project} · {topic}\n\n版本：V{index // 8 + 1}\n此文件为模拟业务文档。\n范围：权限、数据导入、报表、消息及版本发布。\n结论：逐项验收，持续跟踪风险与遗留问题。\n"
    if kind == "png":
        return preview_image(index)
    if kind == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerows(
            [
                ["模块", "待办", "已完成", "责任团队"],
                *[[name, index + i + 3, index + i + 10, project] for i, name in enumerate(MODULES)],
            ]
        )
        return output.getvalue().encode("utf-8-sig")
    if kind in {"txt", "md"}:
        return ("# " + text if kind == "md" else text).encode()
    fixtures = settings.BASE_DIR.parent / "frontend/e2e/fixtures/import-documents"
    if kind == "docx":
        stream = io.BytesIO()
        with (
            zipfile.ZipFile(fixtures / "rich.docx") as source,
            zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as target,
        ):
            for entry in source.infolist():
                value = source.read(entry.filename)
                if entry.filename == "word/document.xml":
                    xml = value.decode()
                    paragraph = (
                        f"<w:p><w:r><w:t>{escape(project + ' · ' + topic)}</w:t></w:r></w:p>"
                    )
                    xml = xml.replace("<w:body>", "<w:body>" + paragraph, 1)
                    value = xml.encode()
                target.writestr(entry, value)
        return stream.getvalue()
    return (
        fixtures / {"xlsx": "multiple.xlsx", "pdf": "sample.pdf", "pptx": "sample.pptx"}[kind]
    ).read_bytes()
