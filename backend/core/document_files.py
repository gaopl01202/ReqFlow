"""Private imported documents: validation and atomic original-file persistence."""

import io
import json
import uuid
import zipfile
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction

from . import models as m
from .policies import access, require, require_action
from .services import audit, document_parent

DOCUMENT_TYPES = frozenset(
    json.loads(Path(__file__).with_name("document_formats.json").read_text())["extensions"]
)


def decode_text(data):
    encodings = (
        ["utf-16"] if data.startswith((b"\xff\xfe", b"\xfe\xff")) else ["utf-8-sig", "gb18030"]
    )
    for encoding in encodings:
        try:
            text = data.decode(encoding)
            if "\x00" not in text:
                return text
        except UnicodeDecodeError:
            pass
    require(False, "文本编码不支持，请使用 UTF-8 或 GB18030")


def validate_source(data, kind):
    require(bool(data), "文档不能为空")
    if kind in {"txt", "csv"}:
        decode_text(data)
    elif kind == "pdf":
        require(data.startswith(b"%PDF-"), "PDF 文件格式无效")
    elif kind == "rtf":
        require(data.lstrip().startswith(b"{\\rtf"), "RTF 文件格式无效")
    elif kind in {"doc", "dot", "xls", "xlt", "xla", "ppt", "pot"}:
        require(data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")), "Office 文件格式无效")
    elif kind in {
        "docx",
        "docm",
        "dotx",
        "dotm",
        "xlsx",
        "xltx",
        "xlsm",
        "xltm",
        "xlsb",
        "pptx",
        "pptm",
        "potx",
        "potm",
        "ppsx",
        "ppsm",
        "odt",
        "ods",
        "odp",
        "xmind",
        "epub",
        "ofd",
    } or data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                info = archive.infolist()
                require(
                    len(info) <= 10000
                    and sum(entry.file_size for entry in info) <= 200 * 1024 * 1024,
                    "文档解压后过大",
                )
                expected = (
                    "word/document.xml"
                    if kind in {"docx", "docm", "dotx", "dotm"}
                    else "xl/workbook.xml"
                    if kind in {"xlsx", "xltx", "xlsm", "xltm"}
                    else "xl/workbook.bin"
                    if kind == "xlsb"
                    else "ppt/presentation.xml"
                    if kind in {"pptx", "pptm", "potx", "potm", "ppsx", "ppsm"}
                    else "content.xml"
                    if kind in {"odt", "ods", "odp"}
                    else None
                )
                if expected:
                    require(expected in archive.namelist(), "Office 文件格式与扩展名不符")
                if kind == "xmind":
                    require(
                        any(name in archive.namelist() for name in ("content.json", "content.xml")),
                        "XMind 文件格式无效",
                    )
                require(not any(entry.flag_bits & 1 for entry in info), "不支持加密文档")
        except (zipfile.BadZipFile, RuntimeError):
            require(False, "文件容器损坏或格式无效")


def import_document(user, pid, upload, parent_id=None):
    require_action(user, "documents", "upload")
    project = m.Project.objects.get(pk=pid, deleted_at=None)
    access(user, project, write=True)
    require(upload is not None, "请选择导入文档")
    require(0 < upload.size <= settings.DOCUMENT_MAX_BYTES, "文档不能为空且不能超过 10 MB")
    original = Path(upload.name.replace("\\", "/")).name
    kind = Path(original).suffix.lower().lstrip(".")
    require(kind in DOCUMENT_TYPES, "不支持此文档类型")
    require(len(original) <= 255 and len(Path(original).stem) <= 200, "文件名称过长")
    content = upload.read(settings.DOCUMENT_MAX_BYTES + 1)
    require(0 < len(content) <= settings.DOCUMENT_MAX_BYTES, "文档不能为空且不能超过 10 MB")
    validate_source(content, kind)
    obj = m.Document(
        project=project,
        title=Path(original).stem,
        body="",
        document_type=kind,
        original_name=original,
        size_bytes=len(content),
        author=user,
        last_editor=user,
    )
    try:
        with transaction.atomic():
            locked = m.Project.objects.select_for_update().get(pk=pid)
            access(user, locked, write=True)
            obj.parent = document_parent(locked, parent_id)
            obj.source_file.save(f"{uuid.uuid4()}.{kind}", ContentFile(content), save=False)
            obj.full_clean()
            obj.save()
            audit(user, obj, "create")
        return obj
    except Exception:
        if obj.source_file and obj.source_file._committed:
            obj.source_file.delete(save=False)
        raise
