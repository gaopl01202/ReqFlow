from .colors import workflow_color

STATES = {
    "requirement": [
        ("planned", "待规划"),
        ("ready", "待开始"),
        ("active", "进行中"),
        ("review", "待验收"),
        ("done", "已完成"),
        ("cancelled", "已取消"),
    ],
    "task": [
        ("ready", "待开始"),
        ("active", "进行中"),
        ("review", "待确认"),
        ("done", "已完成"),
        ("cancelled", "已取消"),
    ],
    "bug": [
        ("new", "待确认"),
        ("ready", "待修复"),
        ("active", "修复中"),
        ("review", "待验证"),
        ("closed", "已关闭"),
        ("rejected", "不予处理"),
    ],
}
EDGES = {
    "requirement": [
        ("planned", "ready"),
        ("ready", "active"),
        ("active", "review"),
        ("review", "done"),
        ("review", "active"),
        ("done", "active"),
    ]
    + [(s, "cancelled") for s in ["planned", "ready", "active", "review"]],
    "task": [
        ("ready", "active"),
        ("active", "review"),
        ("review", "done"),
        ("review", "active"),
        ("done", "active"),
    ]
    + [(s, "cancelled") for s in ["ready", "active", "review"]],
    "bug": [
        ("new", "ready"),
        ("ready", "active"),
        ("active", "review"),
        ("review", "closed"),
        ("new", "rejected"),
        ("review", "ready"),
        ("closed", "ready"),
    ],
}


def legacy_category(code):
    return (
        "completed"
        if code in ["done", "closed"]
        else "cancelled"
        if code in ["cancelled", "rejected"]
        else "pending"
    )


def normalized(workflow):
    from copy import deepcopy

    result = deepcopy(workflow)
    for kind, spec in result.items():
        initial = STATES[kind][0][0]
        for state in spec["states"]:
            state.setdefault("category", legacy_category(state["code"]))
            state.setdefault("initial", state["code"] == initial)
    return result


def state_spec(project, kind, code):
    return next(
        (state for state in normalized(project.workflow)[kind]["states"] if state["code"] == code),
        {},
    )


def defaults():
    return {
        k: {
            "states": [
                {
                    "code": c,
                    "name": n,
                    "color": workflow_color(k, c, legacy_category(c), n, i == 0),
                    "order": i,
                    "initial": i == 0,
                    "category": legacy_category(c),
                }
                for i, (c, n) in enumerate(v)
            ],
            "transitions": [{"from": a, "to": b, "enabled": True} for a, b in EDGES[k]],
        }
        for k, v in STATES.items()
    }
