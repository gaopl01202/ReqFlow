from django.db import migrations

PRESETS = {
    "dictionary": {
        "environment": {"development": "cyan", "testing": "gold", "production": "green"},
        "severity": {"critical": "red", "major": "orange", "normal": "gold", "minor": "cyan"},
        "source": {"internal": "cyan", "feedback": "purple", "other": "default"},
        "priority": {"高": "red", "中": "blue", "低": "default"},
    },
    "names": {
        "environment": {
            "开发": "cyan",
            "测试": "gold",
            "生产": "green",
            "预发": "purple",
            "集成": "geekblue",
        },
        "severity": {
            "致命": "red",
            "阻塞": "red",
            "严重": "orange",
            "一般": "gold",
            "轻微": "cyan",
            "建议": "default",
        },
        "source": {
            "内部": "cyan",
            "反馈": "purple",
            "其他": "default",
            "客户": "purple",
            "外部": "orange",
        },
        "priority": {
            "紧急": "red",
            "最高": "red",
            "高": "red",
            "中": "blue",
            "普通": "blue",
            "低": "default",
        },
    },
    "dictionaryDefaults": {
        "environment": "cyan",
        "severity": "gold",
        "priority": "blue",
        "source": "purple",
    },
    "workflowCodes": {
        "planned": "default",
        "new": "gold",
        "ready": "cyan",
        "active": "blue",
        "review": "purple",
        "done": "green",
        "closed": "green",
        "cancelled": "default",
        "rejected": "default",
    },
    "workflowNames": {
        "阻塞": "red",
        "异常": "red",
        "暂停": "gold",
        "等待": "gold",
        "修复": "blue",
        "进行": "blue",
        "开发": "blue",
        "验收": "purple",
        "验证": "purple",
        "测试": "purple",
        "完成": "green",
        "关闭": "green",
        "取消": "default",
    },
}


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


def apply_palette(apps, schema_editor):
    Priority = apps.get_model("core", "Priority")
    Project = apps.get_model("core", "Project")
    Template = apps.get_model("core", "WorkflowTemplate")
    Audit = apps.get_model("core", "Audit")
    protected_entries, protected_states = set(), {}
    for event in Audit.objects.filter(
        entity_type__in=["Priority", "Project", "WorkflowTemplate"]
    ).iterator():
        before, after = event.before, event.after
        if event.entity_type == "Priority":
            if "color" in before and before.get("color") != after.get("color"):
                protected_entries.add(event.entity_id)
            continue
        previous = before.get("workflow", {})
        for kind, spec in after.get("workflow", {}).items():
            old = {
                state["code"]: state.get("color")
                for state in previous.get(kind, {}).get("states", [])
            }
            for state in spec.get("states", []):
                if state["code"] in old and old[state["code"]] != state.get("color"):
                    protected_states.setdefault((event.entity_type, event.entity_id), set()).add(
                        (kind, state["code"])
                    )
    for entry in Priority.objects.filter(color="blue", deleted_at=None).iterator():
        if str(entry.id) in protected_entries:
            continue
        color = dictionary_color(entry.kind, entry.code, entry.name)
        if color != entry.color:
            entry.color = color
            entry.version += 1
            entry.save(update_fields=["color", "version", "updated_at"])
    for model, label in [(Project, "Project"), (Template, "WorkflowTemplate")]:
        for record in model.objects.filter(deleted_at=None).iterator():
            changed = False
            protected = protected_states.get((label, str(record.id)), set())
            for kind, spec in record.workflow.items():
                for state in spec["states"]:
                    if state.get("color") != "blue" or (kind, state["code"]) in protected:
                        continue
                    color = workflow_color(
                        kind,
                        state["code"],
                        state.get("category", "pending"),
                        state.get("name", ""),
                        state.get("initial", False),
                    )
                    if color != state["color"]:
                        state["color"] = color
                        changed = True
            if changed:
                record.version += 1
                record.save(update_fields=["workflow", "version", "updated_at"])


def restore_palette(apps, schema_editor):
    raise RuntimeError("配色迁移请使用迁移前备份恢复，以保留用户后来修改的颜色")


class Migration(migrations.Migration):
    dependencies = [("core", "0008_configurable_workflows")]
    operations = [migrations.RunPython(apply_palette, restore_palette)]
