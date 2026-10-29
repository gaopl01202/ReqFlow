"""Presentation defaults shared with the frontend; saved user colors remain authoritative."""

import json
from pathlib import Path

PRESETS = json.loads(Path(__file__).with_name("color-presets.json").read_text())


def dictionary_color(kind, code="", name=""):
    exact = PRESETS["dictionary"].get(kind, {})
    if code in exact or name in exact:
        return exact.get(code, exact.get(name))
    return next(
        (color for word, color in PRESETS["names"].get(kind, {}).items() if word in name),
        PRESETS["dictionaryDefaults"].get(kind, "blue"),
    )


def workflow_color(kind, code="", category="pending", name="", initial=False):
    if category == "completed":
        return "green"
    if category == "cancelled":
        return "default"
    if code == "ready" and kind == "bug":
        return "orange"
    if code in PRESETS["workflowCodes"]:
        return PRESETS["workflowCodes"][code]
    return next(
        (color for word, color in PRESETS["workflowNames"].items() if word in name),
        "default" if initial else "cyan",
    )
