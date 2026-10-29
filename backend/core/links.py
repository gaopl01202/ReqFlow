"""Stable human-readable browser links; database identifiers stay unchanged."""

from urllib.parse import quote

from . import models as m


def web_url(obj):
    project = quote(obj.project.code, safe="")
    if isinstance(obj, m.WorkItem):
        return f"/p/{project}/{obj.type}/{obj.number.rsplit('-', 1)[-1]}"
    kind = "document" if isinstance(obj, m.Document) else "iteration"
    return f"/p/{project}/{kind}/{obj.id}"
