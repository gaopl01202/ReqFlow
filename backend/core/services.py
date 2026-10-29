import json
import secrets
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import Case, F, IntegerField, Q, Value, When
from django.utils import timezone

from . import models as m
from .colors import dictionary_color
from .notification_text import notification_message
from .policies import (
    ACTION_KEYS,
    DEFAULT_PERMISSIONS,
    MENU_KEYS,
    PERMISSIONS,
    access,
    admin,
    permission,
    projects,
    require,
    require_action,
    role,
)
from .serializers import SERIALIZERS, serialize
from .workflow import STATES, defaults, normalized, state_spec


def audit(user, obj, action, before=None):
    from .operation_logs import record

    operation = action
    if (
        action == "update"
        and before
        and "enabled" in before
        and before["enabled"] != getattr(obj, "enabled", before["enabled"])
    ):
        operation = "activate" if obj.enabled else "deactivate"
    record(user, obj, operation)
    data = serialize(obj)
    for key in ["must_change_password"]:
        data.pop(key, None)
    m.Audit.objects.create(
        actor=user,
        project=obj
        if isinstance(obj, m.Project)
        else obj.item.project
        if isinstance(obj, m.Comment)
        else getattr(obj, "project", None),
        entity_type=type(obj).__name__,
        entity_id=str(obj.pk),
        action=action,
        before=json.loads(json.dumps(before or {}, cls=DjangoJSONEncoder)),
        after=json.loads(json.dumps(data, cls=DjangoJSONEncoder)),
    )


def version(obj, data):
    require(
        str(data.get("version")) == str(obj.version),
        "数据已更新，请刷新后重试",
        409,
        "CONFLICT",
    )


def save(user, obj, data, action="update"):
    before = serialize(obj) if obj.pk and not obj._state.adding else {}
    serializer = SERIALIZERS.get(type(obj))
    if serializer:
        allowed = {f.name for f in obj._meta.fields}
        for key, value in data.items():
            key = key.removesuffix("_id")
            if key not in allowed or key in [
                "id",
                "created_at",
                "updated_at",
                "version",
                "deleted_at",
            ]:
                continue
            f = obj._meta.get_field(key)
            setattr(obj, f.attname, value if value != "" or not f.null else None)
    obj.version += 1 if not obj._state.adding else 0
    try:
        obj.full_clean(
            exclude=[f.name for f in obj._meta.fields if f.null and getattr(obj, f.attname) is None]
            + ["password"]
        )
    except ValidationError as exc:
        if isinstance(obj, m.Project) and any(
            error.code == "unique" for error in getattr(exc, "error_dict", {}).get("code", [])
        ):
            require(False, "项目编码已存在，请更换")
        require(False, str(exc))
    try:
        with transaction.atomic():
            obj.save()
    except IntegrityError:
        if (
            isinstance(obj, m.Project)
            and m.Project.objects.filter(code=obj.code).exclude(pk=obj.pk).exists()
        ):
            require(False, "项目编码已存在，请更换")
        raise
    audit(user, obj, action, before)
    return obj


def active_user(uid):
    user = m.User.objects.filter(pk=uid, is_active=True, deleted_at=None).first()
    require(user is not None, "用户不可用")
    return user


def assignee(project, uid):
    if not uid:
        return None
    user = active_user(uid)
    require(
        m.Member.objects.filter(
            project=project, user=user, role__in=["admin", "member"], deleted_at=None
        ).exists(),
        "负责人必须是可写项目成员",
    )
    return user


def handler_ids(item):
    return list(item.handlers.values_list("id", flat=True)) or (
        [item.assignee_id] if item.assignee_id else []
    )


def validated_handlers(project, data, item=None, required=False):
    ids = data.get(
        "handlers",
        [data["assignee"]]
        if data.get("assignee")
        else []
        if "assignee" in data
        else handler_ids(item)
        if item
        else [],
    )
    require(isinstance(ids, list) and len(ids) <= 100 and all(ids), "处理人列表无效")
    require(len({str(uid) for uid in ids}) == len(ids), "处理人不能重复")
    require(not required or bool(ids), "请选择至少一位处理人")
    return [assignee(project, uid).id for uid in ids if uid]


def set_handlers(item, ids):
    item.handlers.set(ids)
    item.assignee_id = ids[0] if ids else None


def dates(data, start="planned_start_date", end="due_date"):
    if data.get(start) and data.get(end):
        require(str(data[end]) >= str(data[start]), "结束日期不得早于开始日期")


def deliver_event(event_id):
    import logging

    try:
        with transaction.atomic():
            event = m.NotificationEvent.objects.select_for_update().get(pk=event_id)
            if event.delivered_at:
                return
            item = event.item
            for uid in event.recipients:
                user = m.User.objects.filter(pk=uid, is_active=True, deleted_at=None).first()
                if not user or (event.actor_id and str(event.actor_id) == uid):
                    continue
                if (
                    item.deleted_at
                    or item.project.status != "active"
                    or not projects(user).filter(pk=item.project_id).exists()
                ):
                    continue
                if event.event_type in ["due", "overdue", "assignment"] and uid not in {
                    str(value) for value in handler_ids(item)
                }:
                    continue
                m.Notification.objects.get_or_create(
                    recipient=user,
                    dedupe_key=event.dedupe_key,
                    defaults={
                        "project": item.project,
                        "item": item,
                        "event_type": event.event_type,
                        "message": notification_message(
                            f"{item.number} {item.title}：{event.event_type}", event.event_type
                        ),
                    },
                )
            event.delivered_at = timezone.now()
            event.attempts += 1
            event.save()
    except Exception:
        # The persistent outbox is retried by remind; never report a committed business write as failed.
        logging.getLogger(__name__).error("notification_delivery_failed event_id=%s", event_id)
        try:
            m.NotificationEvent.objects.filter(pk=event_id).update(attempts=F("attempts") + 1)
        except Exception:
            pass


def notify(item, event, actor=None, recipients=None, key=None):
    ids = recipients if recipients is not None else [*handler_ids(item), item.created_by_id]
    row, _ = m.NotificationEvent.objects.get_or_create(
        dedupe_key=key or f"{item.pk}:{event}:{item.version}",
        defaults={
            "item": item,
            "actor": actor,
            "event_type": event,
            "recipients": sorted({str(uid) for uid in ids if uid}),
        },
    )
    transaction.on_commit(lambda: deliver_event(row.pk))


@transaction.atomic
def create_project(user, data):
    require_action(user, "projects", "create")
    require(permission(user, "create_project"), "无创建项目权限", 403, "FORBIDDEN")
    require(
        bool(data.get("code")) and all(c.isalnum() or c in "-_" for c in data["code"]),
        "项目编码只能包含字母、数字、下划线和短横线",
    )
    owner = active_user(data.get("owner") or user.id)
    dates(data, "planned_start_date", "planned_end_date")
    p = save(
        user,
        m.Project(owner=owner, workflow=default_workflow()),
        {
            k: v
            for k, v in data.items()
            if k in ["code", "name", "description", "planned_start_date", "planned_end_date"]
        },
        "create",
    )
    copy_dictionaries(p)
    for u in {user, owner}:
        m.Member.objects.create(project=p, user=u, role="admin")
    return p


@transaction.atomic
def update_project(user, pid, data, action=None):
    require_action(user, "projects", "status" if action else "edit")
    p = m.Project.objects.select_for_update().get(pk=pid)
    access(user, p)
    require(
        role(user, p) == "admin" and permission(user, "manage_members"),
        "需要项目管理权限",
        403,
        "FORBIDDEN",
    )
    version(p, data)
    if action in ["close", "reopen"]:
        return save(user, p, {"status": "closed" if action == "close" else "active"}, action)
    access(user, p, manage=True)
    require("code" not in data or data["code"] == p.code, "项目编码不可修改")
    if data.get("owner"):
        owner = assignee(p, data["owner"])
        require(role(owner, p) == "admin", "负责人必须是项目管理员")
    return save(
        user,
        p,
        {
            k: v
            for k, v in data.items()
            if k
            in [
                "name",
                "description",
                "owner",
                "planned_start_date",
                "planned_end_date",
            ]
        },
    )


def handover(user, p, uid, data):
    items = m.WorkItem.objects.select_for_update().filter(
        pk__in=m.WorkItem.objects.filter(
            Q(assignee_id=uid) | Q(handlers__id=uid), project=p, deleted_at=None
        )
        .exclude(status_category__in=["completed", "cancelled"])
        .values("pk")
    )
    if not items.exists():
        return
    plan = data.get("unfinished_items", {})
    require(
        plan.get("action") in ["unassign", "reassign", "individual"],
        "须移交未完成项或确认设为未分配",
    )
    mapping = plan.get("items", {})
    for item in items:
        target = (
            mapping.get(str(item.id))
            if plan["action"] == "individual"
            else plan.get("new_owner_id")
            if plan["action"] == "reassign"
            else None
        )
        if plan["action"] == "individual":
            require(str(item.id) in mapping, "必须逐项指定移交方案")
        require(str(target) != str(uid), "接替人不能是被移除用户")
        new = assignee(p, target)
        if plan["action"] == "reassign":
            require(new is not None, "请选择接替人")
        before = serialize(item)
        ids = [value for value in handler_ids(item) if str(value) != str(uid)]
        if new and new.id not in ids:
            ids.append(new.id)
        set_handlers(item, ids)
        item.version += 1
        item.save()
        audit(user, item, "handover", before)
        notify(item, "assignment", user, [new.id] if new else [])


@transaction.atomic
def member_write(user, pid, data, uid=None, delete=False):
    require_action(user, "members", "delete" if delete else "edit" if uid else "create")
    p = m.Project.objects.select_for_update().get(pk=pid)
    access(user, p, manage=True)
    if uid:
        member = m.Member.objects.select_for_update().get(project=p, user_id=uid, deleted_at=None)
        version(member, data)
        require(
            str(p.owner_id) != str(uid)
            or (not delete and data.get("role", member.role) == "admin"),
            "请先转移项目负责人",
        )
        if member.role == "admin" and (delete or data.get("role", member.role) != "admin"):
            require(
                m.Member.objects.filter(project=p, role="admin", deleted_at=None).count() > 1,
                "项目至少保留一名管理员",
            )
        if delete:
            handover(user, p, uid, data)
            return soft_delete(user, member)
        require(data.get("role") in ["admin", "member", "readonly"], "无效角色")
        if data["role"] == "readonly":
            handover(user, p, uid, data)
        return save(user, member, {"role": data["role"]})
    target = active_user(data.get("user"))
    require(data.get("role") in ["admin", "member", "readonly"], "无效角色")
    existing = m.Member.objects.filter(project=p, user=target).first()
    require(not existing or existing.deleted_at, "成员已存在")
    if existing:
        existing.deleted_at = None
        return save(user, existing, {"role": data["role"]}, "add")
    return save(user, m.Member(project=p, user=target), {"role": data["role"]}, "add")


def soft_delete(user, obj):
    before = serialize(obj)
    obj.deleted_at = timezone.now()
    obj.version += 1
    obj.save()
    audit(user, obj, "delete", before)
    return obj


DICTIONARY_KINDS = ["environment", "severity", "priority", "source"]
DICTIONARY_DEFAULTS = {
    "environment": [
        ("development", "开发环境"),
        ("testing", "测试环境"),
        ("production", "生产环境"),
    ],
    "severity": [("critical", "致命"), ("major", "严重"), ("normal", "一般"), ("minor", "轻微")],
    "source": [("internal", "内部提出"), ("feedback", "用户反馈"), ("other", "其他")],
}


def copy_dictionaries(project):
    list(m.UserGroup.objects.select_for_update().order_by("id"))
    require(
        m.Priority.objects.filter(
            project=None, kind="priority", enabled=True, deleted_at=None
        ).exists(),
        "默认字典至少需要一个启用优先级",
    )
    for kind in DICTIONARY_KINDS:
        templates = list(
            m.Priority.objects.filter(project=None, kind=kind, deleted_at=None).order_by(
                "sort_order", "id"
            )
        )
        for template in templates:
            m.Priority.objects.create(
                project=project,
                kind=kind,
                code=template.code or str(template.id).replace("-", "")[:20],
                name=template.name,
                color=template.color,
                enabled=template.enabled,
                sort_order=template.sort_order,
            )


def dictionary_reference(obj):
    if obj.kind == "priority":
        return m.WorkItem.objects.filter(priority=obj).exists()
    if not obj.project_id:
        return False
    if obj.kind == "source":
        return m.RequirementDetail.objects.filter(
            item__project=obj.project, source=obj.code
        ).exists()
    return m.BugDetail.objects.filter(item__project=obj.project, **{obj.kind: obj.code}).exists()


def validate_dictionary(project, kind, value, old=None):
    if value == old:
        return
    require(
        not value
        or m.Priority.objects.filter(
            project=project, kind=kind, code=value, enabled=True, deleted_at=None
        ).exists(),
        "所选字典项不可用",
    )


def default_priority(project):
    priority = (
        m.Priority.objects.filter(
            project=project, kind="priority", enabled=True, deleted_at=None, name="中"
        ).first()
        or m.Priority.objects.filter(
            project=project, kind="priority", enabled=True, deleted_at=None
        )
        .order_by("sort_order")
        .first()
    )
    require(priority is not None, "没有启用优先级")
    return priority.pk


def item_values(user, p, data, obj=None):
    values = {
        k: v
        for k, v in data.items()
        if k
        in [
            "title",
            "description",
            "priority",
            "category",
            "assignee",
            "iteration",
            "planned_start_date",
            "due_date",
        ]
    }
    if "assignee" in values:
        assignee(p, values["assignee"])
    for field, model in [
        ("priority", m.Priority),
        ("category", m.Category),
        ("iteration", m.Iteration),
    ]:
        if field not in values:
            continue
        value = values[field]
        old = getattr(obj, field + "_id", None) if obj else None
        if not value:
            if field == "priority":
                value = values[field] = default_priority(p)
            else:
                continue
        ref = model.objects.filter(pk=value, deleted_at=None).first()
        require(ref is not None, "所选配置不可用")
        require(ref.project_id == p.id, "关联对象必须属于同一项目")
        if field == "priority":
            require(ref.kind == "priority", "请选择优先级字典项")
        if field == "iteration":
            require(ref.status != "finished" or str(old) == str(value), "目标迭代已结束")
        elif str(old) != str(value):
            require(ref.enabled, "所选配置已停用")
    if (
        obj
        and "iteration" in values
        and str(values["iteration"] or "") != str(obj.iteration_id or "")
        and obj.iteration_id
    ):
        require(obj.iteration.status != "finished", "已结束迭代的工作项不可变更归属")
    merged = {k: getattr(obj, k, None) for k in ["planned_start_date", "due_date"]} if obj else {}
    merged.update(values)
    dates(merged)
    return values


def detail_write(user, item, data, create=False):
    cls = {
        "requirement": m.RequirementDetail,
        "task": m.TaskDetail,
        "bug": m.BugDetail,
    }[item.type]
    detail = cls(item=item) if create else cls.objects.get(item=item)
    allowed = {
        "requirement": [
            "source",
            "proposer",
            "acceptance_criteria",
            "expected_finish_date",
        ],
        "task": ["requirement"],
        "bug": [
            "steps_to_reproduce",
            "actual_result",
            "expected_result",
            "environment",
            "severity",
            "requirement",
            "task",
        ],
    }[item.type]
    if create:
        for key in ["source", "severity"]:
            if hasattr(detail, key) and key not in data:
                selected = m.Priority.objects.filter(
                    project=item.project, kind=key, enabled=True, deleted_at=None
                )
                option = (
                    selected.filter(code=getattr(detail, key)).first()
                    or selected.order_by("sort_order").first()
                )
                setattr(detail, key, option.code if option else "")
    previous = {key: getattr(detail, key) for key in ["source"] if hasattr(detail, key)}
    previous.update(
        {key: getattr(detail, key) for key in ["environment", "severity"] if hasattr(detail, key)}
    )
    for key in allowed:
        if key in data:
            if key in ["requirement", "task"] and data[key]:
                require(
                    m.WorkItem.objects.filter(
                        pk=data[key], project=item.project, type=key, deleted_at=None
                    ).exists(),
                    "关联对象必须是同项目可用工作项",
                )
            setattr(
                detail,
                key + "_id" if key in ["requirement", "task"] else key,
                data[key] or None
                if key in ["requirement", "task", "expected_finish_date"]
                else data[key],
            )
    if item.type == "requirement":
        validate_dictionary(
            item.project, "source", detail.source, previous.get("source") if not create else None
        )
    if item.type == "bug":
        for key in ["severity", "environment"]:
            validate_dictionary(
                item.project, key, getattr(detail, key), previous.get(key) if not create else None
            )
        if create:
            detail.reporter = user
    detail.full_clean(
        exclude=[
            f.name for f in detail._meta.fields if f.null and getattr(detail, f.attname) is None
        ]
    )
    detail.save()


@transaction.atomic
def create_item(user, pid, data):
    require_action(user, "items", "create")
    p = m.Project.objects.select_for_update().get(pk=pid)
    access(user, p, write=True)
    kind = data.get("type")
    require(kind in STATES, "工作项类型无效")
    if not data.get("priority"):
        data = {**data, "priority": default_priority(p)}
    values = item_values(user, p, data)
    counter, _ = m.Counter.objects.get_or_create(project=p, item_type=kind)
    counter = m.Counter.objects.select_for_update().get(pk=counter.pk)
    counter.value += 1
    counter.save()
    number = (
        f"{p.code}-" + {"task": "T", "requirement": "R", "bug": "B"}[kind] + f"-{counter.value}"
    )
    obj = m.WorkItem(
        project=p,
        type=kind,
        number=number,
        status=next(
            state["code"] for state in normalized(p.workflow)[kind]["states"] if state["initial"]
        ),
        created_by=user,
    )
    # Detail must exist before the full work-item serializer is used for audit.
    for key, value in values.items():
        field = obj._meta.get_field(key)
        setattr(obj, field.attname, value)
    obj.full_clean(
        exclude=[f.name for f in obj._meta.fields if f.null and getattr(obj, f.attname) is None]
    )
    obj.save()
    set_handlers(obj, validated_handlers(p, data))
    obj.save(update_fields=["assignee"])
    detail_write(user, obj, data, True)
    audit(user, obj, "create")
    notify(obj, "assignment", user, handler_ids(obj))
    return obj


@transaction.atomic
def update_item(user, iid, data, action=None):
    require_action(
        user,
        "iterations"
        if action == "iteration_assign"
        else "recycle-bin"
        if action == "restore"
        else "items",
        "assign"
        if action == "iteration_assign"
        else "restore"
        if action == "restore"
        else action or "edit",
    )
    raw = m.WorkItem.objects.get(pk=iid)
    p = m.Project.objects.select_for_update().get(pk=raw.project_id)
    obj = m.WorkItem.objects.select_for_update().get(pk=iid)
    access(user, p, write=True, item=obj)
    require(not obj.deleted_at or action == "restore", "已删除或无权访问", 404, "NOT_FOUND")
    version(obj, data)
    if action == "restore":
        require(role(user, p) == "admin", "需要项目管理员", 403, "FORBIDDEN")
        item_values(
            user,
            p,
            {
                k: str(getattr(obj, k + "_id")) if getattr(obj, k + "_id") else None
                for k in ["assignee", "priority", "category", "iteration"]
            },
            obj,
        )
        detail = serialize(obj)["details"]
        detail_write(user, obj, {k: v for k, v in detail.items() if k in ["requirement", "task"]})
        before = serialize(obj)
        obj.deleted_at = None
        obj.version += 1
        obj.save()
        audit(user, obj, "restore", before)
        return obj
    if action == "delete":
        require(
            role(user, p) == "admin" or obj.created_by_id == user.id,
            "只有创建人或管理员可删除",
            403,
            "FORBIDDEN",
        )
        has_links = (
            m.TaskDetail.objects.filter(requirement=obj).exists()
            or m.BugDetail.objects.filter(Q(requirement=obj) | Q(task=obj)).exists()
        )
        require(not has_links or data.get("confirm"), "存在关联工作项，确认影响后再删除")
        return soft_delete(user, obj)
    if action == "transition":
        target = data.get("target_status")
        edges = p.workflow[obj.type]["transitions"]
        reactivating = data.get("reactivate", False)
        if reactivating:
            require(
                not any(e["from"] == obj.status and e["enabled"] for e in edges),
                "当前状态仍有下一节点，请使用正常流转",
            )
            require(
                target != obj.status
                and state_spec(p, obj.type, target).get("category") == "pending",
                "重新激活只能选择其他未完成状态",
            )
        else:
            require(
                any(e["from"] == obj.status and e["to"] == target and e["enabled"] for e in edges),
                "不允许此状态流转",
            )
        require(
            not data.get("_uploads") or bool(str(data.get("body", "")).strip()),
            "图片需要随评论提交",
        )
        before = serialize(obj)
        old_handlers = handler_ids(obj)
        set_handlers(obj, validated_handlers(p, data, obj, required=True))
        obj.status = target
        obj.status_category = state_spec(p, obj.type, target)["category"]
        obj.completed_at = timezone.now() if obj.status_category == "completed" else None
        obj.version += 1
        obj.save()
        if obj.type == "bug":
            detail = m.BugDetail.objects.get(item=obj)
            if reactivating:
                detail.submitted_by = None
                detail.submitted_at = None
                detail.verified_by = None
                detail.verified_at = None
            if target == "review":
                detail.submitted_by = user
                detail.submitted_at = timezone.now()
            if obj.status_category == "completed":
                detail.verified_by = user
                detail.verified_at = timezone.now()
            detail.save()
        audit(user, obj, "reactivate" if reactivating else "transition", before)
        if data.get("reason"):
            event = m.Audit.objects.filter(entity_id=str(obj.id)).latest("created_at")
            event.after = {**event.after, "reason": data["reason"]}
            event.save()
        notify(obj, "status", user)
        if set(old_handlers) != set(handler_ids(obj)):
            notify(obj, "assignment", user, handler_ids(obj))
        if str(data.get("body", "")).strip():
            write_record(
                user,
                data,
                lambda: comment_write(
                    user, obj.pk, {"body": data["body"], "mentions": data.get("mentions", [])}
                ),
            )
        return obj
    before = serialize(obj)
    old = set(handler_ids(obj))
    ids = validated_handlers(p, data, obj)
    vals = item_values(user, p, data, obj)
    for key, value in vals.items():
        setattr(obj, obj._meta.get_field(key).attname, value)
    obj.full_clean(
        exclude=[f.name for f in obj._meta.fields if f.null and getattr(obj, f.attname) is None]
    )
    obj.version += 1
    obj.save()
    set_handlers(obj, ids)
    obj.save(update_fields=["assignee"])
    detail_write(user, obj, data)
    audit(user, obj, "update", before)
    if old != set(handler_ids(obj)):
        notify(obj, "assignment", user, handler_ids(obj))
    return obj


@transaction.atomic
def iteration_write(user, pid, data, iid=None, action=None):
    require_action(user, "iterations", action or ("edit" if iid else "create"))
    p = m.Project.objects.select_for_update().get(pk=pid)
    access(user, p, manage=True)
    obj = (
        m.Iteration.objects.select_for_update().get(pk=iid, project=p)
        if iid
        else m.Iteration(project=p)
    )
    if iid:
        version(obj, data)
        require(obj.status != "finished", "已结束迭代不可编辑")
    if action == "start":
        require(obj.status == "planned", "只有未开始迭代可开始")
        return save(user, obj, {"status": "active"}, "start")
    if action == "finish":
        require(obj.status == "active", "只有进行中迭代可结束")
        items = (
            m.WorkItem.objects.select_for_update()
            .filter(iteration=obj, deleted_at=None)
            .exclude(status_category__in=["completed", "cancelled"])
        )
        if items.exists():
            require(
                data.get("disposition") in ["keep", "move"] and data.get("confirm"),
                "请选择未完成项处置方式并确认",
            )
            if data["disposition"] == "move":
                target = (
                    m.Iteration.objects.filter(
                        pk=data.get("target_iteration"), project=p, deleted_at=None
                    )
                    .exclude(status="finished")
                    .exclude(pk=obj.pk)
                    .first()
                )
                require(target is not None, "请选择另一未结束迭代")
                for item in items:
                    save(user, item, {"iteration": target.id}, "iteration_move")
        return save(user, obj, {"status": "finished"}, "finish")
    vals = {
        k: v for k, v in data.items() if k in ["name", "goal", "owner", "start_date", "end_date"]
    }
    if "owner" in vals:
        assignee(p, vals["owner"])
    merged = {k: getattr(obj, k, None) for k in ["start_date", "end_date"]}
    merged.update(vals)
    dates(merged, "start_date", "end_date")
    if merged.get("start_date") and merged.get("end_date"):
        overlap = (
            m.Iteration.objects.filter(
                project=p,
                deleted_at=None,
                start_date__lte=merged["end_date"],
                end_date__gte=merged["start_date"],
            )
            .exclude(pk=obj.pk)
            .exists()
        )
        require(not overlap or data.get("confirm_overlap"), "迭代日期重叠，确认后可继续保存")
    return save(user, obj, vals, "update" if iid else "create")


def document_parent(project, parent_id):
    if not parent_id:
        return None
    parent = m.Document.objects.filter(
        pk=parent_id, project=project, deleted_at=None, document_type="folder"
    ).first()
    require(parent is not None, "文件夹不存在或无权访问", 404, "NOT_FOUND")
    return parent


def document_listing(user, project, parent_id):
    access(user, project)
    parent = document_parent(project, parent_id)
    ancestors = []
    node = parent
    while node:
        ancestors.insert(0, {"id": str(node.id), "title": node.title})
        node = node.parent
    return m.Document.objects.filter(
        project=project, parent=parent, deleted_at=None
    ).select_related("project", "author").annotate(
        folder_first=Case(
            When(document_type="folder", then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )
    ).order_by("folder_first", "-updated_at"), ancestors


@transaction.atomic
def document_write(user, pid, data, did=None, delete=False):
    require_action(user, "documents", "delete" if delete else "edit" if did else "folder")
    p = m.Project.objects.select_for_update().get(pk=pid)
    access(user, p, write=True)
    obj = (
        m.Document.objects.get(pk=did, project=p, deleted_at=None)
        if did
        else m.Document(project=p, author=user, last_editor=user)
    )
    if did:
        version(obj, data)
    if delete:
        require(role(user, p) == "admin", "只有项目管理员可删除文档", 403, "FORBIDDEN")
        require(not obj.children.filter(deleted_at=None).exists(), "文件夹非空，请先删除其中内容")
        return soft_delete(user, obj)
    if not did:
        require(data.get("document_type") == "folder", "不再支持新建文档，请上传文档")
        parent = document_parent(p, data.get("parent"))
        title = str(data.get("title", "")).strip()
        require(
            bool(title)
            and len(title) <= 200
            and not any(c in title for c in "/\\")
            and title not in {".", ".."},
            "请填写有效的文件夹名称",
        )
        require(
            not m.Document.objects.filter(
                project=p,
                parent=parent,
                title__iexact=title,
                document_type="folder",
                deleted_at=None,
            ).exists(),
            "当前目录已存在同名文件夹",
        )
        obj.document_type = "folder"
        obj.parent = parent
        return save(user, obj, {"title": title}, "create")
    require(obj.document_type == "markdown", "导入文档不支持在线编辑")
    require(bool(str(data.get("body", obj.body)).strip()), "请填写正文")
    return save(
        user,
        obj,
        {
            **{k: v for k, v in data.items() if k in ["title", "body"]},
            "last_editor": user.id,
        },
        "update" if did else "create",
    )


@transaction.atomic
def comment_write(user, iid, data, cid=None, delete=False):
    require_action(user, "items", "comment")
    raw = m.WorkItem.objects.get(pk=iid, deleted_at=None)
    p = m.Project.objects.select_for_update().get(pk=raw.project_id)
    item = m.WorkItem.objects.select_for_update().get(pk=iid, deleted_at=None)
    access(user, p, write=True)
    obj = (
        m.Comment.objects.get(pk=cid, item=item, deleted_at=None)
        if cid
        else m.Comment(
            item=item,
            author=user,
            workflow_status=item.status,
            workflow_status_name=serialize(item)["status_name"],
        )
    )
    if cid:
        version(obj, data)
        require(
            obj.author_id == user.id or (delete and role(user, p) == "admin"),
            "只能编辑自己的评论",
            403,
            "FORBIDDEN",
        )
    if delete:
        return soft_delete(user, obj)
    mentions = data.get("mentions", [])
    for uid in mentions:
        require(
            m.Member.objects.filter(
                project=p, user_id=uid, deleted_at=None, user__is_active=True
            ).exists(),
            "只能提及当前项目成员",
        )
    require(bool(str(data.get("body", obj.body)).strip()), "请输入评论")
    obj = save(user, obj, {"body": data.get("body", obj.body)}, "comment")
    obj.mentions.set(mentions)
    notify(item, "comment", user, key=f"comment:{obj.pk}:{obj.version}:comment")
    notify(item, "mention", user, mentions, key=f"comment:{obj.pk}:{obj.version}")
    return obj


@transaction.atomic
def user_write(actor, data, uid=None, action=None):
    require_action(
        actor,
        "users",
        {"activate": "toggle", "deactivate": "toggle", "reset-password": "reset_password"}.get(
            action, action or ("edit" if uid else "create")
        ),
    )
    # Global lock serializes last-admin checks and user-group downgrades.
    list(m.UserGroup.objects.select_for_update().order_by("id"))
    obj = m.User.objects.select_for_update().get(pk=uid, deleted_at=None) if uid else m.User()
    if uid:
        version(obj, data)
        if obj.is_superuser:
            require(
                action == "reset-password" and actor.pk == obj.pk,
                "系统管理员不可编辑或停用，只有本人可以重置自己的密码",
                403,
                "FORBIDDEN",
            )
    if (
        uid
        and obj.is_superuser
        and (
            action in ["deactivate", "delete"]
            or ("group" in data and str(data["group"]) != str(obj.group_id))
        )
    ):
        require(
            m.User.objects.filter(is_superuser=True, is_active=True, deleted_at=None)
            .exclude(pk=obj.pk)
            .exists(),
            "不能停用、删除或降权最后一名系统管理员",
        )
    before = serialize(obj) if uid else {}
    temp = None
    if action == "delete":
        require(not obj.is_active, "仅停用用户可删除")
        return soft_delete(actor, obj), None
    if action in ["activate", "deactivate"]:
        if action == "deactivate":
            owned = m.Project.objects.filter(owner=obj)
            require(not owned.exists(), "请先转移项目负责人")
            for p in m.Project.objects.select_for_update().filter(
                pk__in=m.WorkItem.objects.filter(Q(assignee=obj) | Q(handlers=obj)).values(
                    "project_id"
                )
            ):
                handover(actor, p, obj.id, data)
        obj.is_active = action == "activate"
        if action == "deactivate":
            from .sessions import revoke_user_sessions

            revoke_user_sessions(obj)
        # Authentication checks is_active on every request; reset is independent.
    elif action == "reset-password":
        temp = secrets.token_urlsafe(15)
        obj.set_password(temp)
        obj.must_change_password = True
        from .sessions import revoke_user_sessions

        revoke_user_sessions(obj)
    else:
        require(
            not uid or data.get("username", obj.username) == obj.username,
            "登录账号不可修改",
        )
        for key in ["username", "display_name"]:
            if key in data:
                setattr(obj, key, data[key])
        for key, cls in [("group", m.UserGroup), ("position", m.Position)]:
            if key in data or not uid:
                refs = cls.objects.filter(pk=data.get(key), deleted_at=None)
                if not uid or str(data.get(key)) != str(getattr(obj, key + "_id")):
                    refs = refs.filter(enabled=True)
                ref = refs.first()
                require(ref is not None, "请选择启用的用户组与职务")
                setattr(obj, key, ref)
        becoming_admin = bool(obj.group and obj.group.builtin and obj.group.name == "系统管理员")
        require(
            not becoming_admin or admin(actor),
            "只有系统管理员可以授予系统管理员身份",
            403,
            "FORBIDDEN",
        )
        obj.is_superuser = becoming_admin
        if not uid:
            temp = secrets.token_urlsafe(15)
            obj.set_password(temp)
    obj.version += 1 if uid else 0
    obj.full_clean(
        exclude=[f.name for f in obj._meta.fields if f.null and getattr(obj, f.attname) is None]
    )
    obj.save()
    audit(actor, obj, action or ("update" if uid else "create"), before)
    return obj, temp


@transaction.atomic
def config_write(user, model, data, pk=None, pid=None, delete=False):
    if pid:
        p = m.Project.objects.select_for_update().get(pk=pid)
        access(user, p, manage=True)
    else:
        p = None
    menu = (
        "items"
        if model == m.Category
        else "dictionaries"
        if p
        else {m.UserGroup: "user-groups", m.Position: "positions", m.Priority: "priorities"}[model]
    )
    operation = (
        "categories"
        if model == m.Category
        else "delete"
        if delete
        else "create"
        if not pk
        else "toggle"
        if "enabled" in data
        and not (
            set(data) & {"name", "color", "permissions", "menu_permissions", "action_permissions"}
        )
        else "edit"
    )
    require_action(user, menu, operation)
    if pk and "enabled" in data and operation != "toggle" and model != m.Category:
        require_action(user, menu, "toggle")
    list(m.UserGroup.objects.select_for_update().order_by("id"))
    obj = model.objects.select_for_update().get(pk=pk, deleted_at=None) if pk else model()
    if model == m.Priority:
        require(
            not pk or obj.project_id == (p.id if p else None), "已删除或无权访问", 404, "NOT_FOUND"
        )
        if not pk:
            obj.project = p
            obj.kind = data.get("kind", "priority")
            obj.code = secrets.token_hex(8)
            if "color" not in data:
                obj.color = dictionary_color(obj.kind, name=data.get("name", ""))
        require(obj.kind in DICTIONARY_KINDS, "未知字典类型")
    if model in [m.Position, m.Priority, m.Category]:
        require("sort_order" not in data, "请通过拖动调整顺序")
        if not pk:
            options = model.objects.filter(deleted_at=None)
            if p:
                options = options.filter(project=p)
            if model == m.Priority:
                options = options.filter(project=p, kind=obj.kind)
            last = options.order_by("-sort_order").first()
            obj.sort_order = last.sort_order + 1 if last else 0
    if p:
        if pk:
            require(obj.project_id == p.id, "已删除或无权访问", 404, "NOT_FOUND")
        else:
            obj.project = p
    if pk:
        version(obj, data)
    if model == m.UserGroup:
        require(
            not (obj.builtin and obj.name == "系统管理员") or admin(user),
            "只有系统管理员可以维护系统管理员组",
            403,
            "FORBIDDEN",
        )
        require(admin(user) or "permissions" not in data, "不能修改兼容权限码", 403, "FORBIDDEN")
        if "action_permissions" in data:
            actions = data["action_permissions"]
            require(
                isinstance(actions, list)
                and all(isinstance(key, str) and key in ACTION_KEYS for key in actions)
                and len(actions) == len(set(actions)),
                "未知或重复功能权限",
            )
            menus = data.get("menu_permissions", obj.menu_permissions)
            require(
                isinstance(menus, list) and all(key.split(":")[0] in menus for key in actions),
                "功能权限必须属于已选菜单",
            )
        elif "menu_permissions" in data and obj.action_permissions is not None:
            data = {
                **data,
                "action_permissions": [
                    key
                    for key in obj.action_permissions
                    if key.split(":")[0] in data["menu_permissions"]
                ],
            }
        if "menu_permissions" in data:
            menus = data["menu_permissions"]
            require(
                isinstance(menus, list)
                and all(isinstance(key, str) and key in MENU_KEYS for key in menus)
                and len(set(menus)) == len(menus),
                "未知或重复菜单权限",
            )
            if not pk and "permissions" not in data:
                data = {**data, "permissions": DEFAULT_PERMISSIONS}
        require(all(c in PERMISSIONS for c in data.get("permissions", [])), "未知权限码")
        if obj.builtin:
            require(data.get("name", obj.name) == obj.name, "内置组不能改名")
            if obj.name == "系统管理员":
                require(data.get("enabled", True) and not delete, "管理员组不能停用或删除")
        if data.get("enabled") is False:
            require(
                not m.User.objects.filter(group=obj, deleted_at=None).exists(),
                "请先迁移组内用户",
            )
        if delete:
            require(
                not obj.builtin and not m.User.objects.filter(group=obj).exists(),
                "内置或已引用用户组不可删除",
            )
    if model == m.Priority and (delete or data.get("enabled") is False):
        list(m.Priority.objects.select_for_update().all())
        require(
            obj.kind != "priority"
            or m.Priority.objects.filter(project=p, kind="priority", enabled=True, deleted_at=None)
            .exclude(pk=obj.pk)
            .exists(),
            "至少保留一个启用优先级",
        )
    if delete:
        if model == m.Position:
            require(not m.User.objects.filter(position=obj).exists(), "被引用职务不可删除")
        if model == m.Priority:
            require(
                not dictionary_reference(obj),
                "已引用字典项不可删除，请停用",
            )
        if model == m.Category:
            items = list(m.WorkItem.objects.select_for_update().filter(category=obj))
            require(
                not items or data.get("confirm") is True,
                "删除后都将移动到默认分类",
                409,
                "CATEGORY_MOVE_CONFIRMATION_REQUIRED",
            )
            for item in items:
                before = serialize(item)
                item.category = None
                item.version += 1
                item.save(update_fields=["category", "version", "updated_at"])
                audit(user, item, "update", before)
        return soft_delete(user, obj)
    if "color" in data:
        require(
            data["color"]
            in [
                "red",
                "orange",
                "gold",
                "green",
                "blue",
                "purple",
                "cyan",
                "geekblue",
                "default",
            ],
            "请选择预设颜色",
        )
    return save(
        user,
        obj,
        {
            k: v
            for k, v in data.items()
            if k
            in [
                "name",
                "sort_order",
                "color",
                "enabled",
                "permissions",
                "menu_permissions",
                "action_permissions",
            ]
        },
        "update" if pk else "create",
    )


def default_workflow():
    template = m.WorkflowTemplate.objects.select_for_update().filter(key="default").first()
    return normalized(template.workflow if template else defaults())


def validate_workflow(workflow, project=None):
    import re

    require(isinstance(workflow, dict) and set(workflow) == set(STATES), "工作流类型不完整")
    for spec in workflow.values():
        require(
            isinstance(spec, dict)
            and isinstance(spec.get("states"), list)
            and isinstance(spec.get("transitions"), list),
            "状态和流转路径必须是列表",
        )
        require(
            all(
                isinstance(state, dict)
                and isinstance(state.get("name"), str)
                and isinstance(state.get("code"), str)
                for state in spec["states"]
            ),
            "状态字段无效",
        )
        require(
            all(
                isinstance(edge, dict)
                and isinstance(edge.get("from"), str)
                and isinstance(edge.get("to"), str)
                for edge in spec["transitions"]
            ),
            "流转字段无效",
        )
    workflow = normalized(workflow)
    for kind, spec in workflow.items():
        states = spec.get("states", [])
        require(isinstance(states, list) and 2 <= len(states) <= 100, "每种工作项需要2至100个状态")
        codes, names = set(), set()
        for state in states:
            code, name = state.get("code", ""), state.get("name", "").strip()
            require(
                isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,29}", code),
                "状态标识无效",
            )
            require(code not in codes and name not in names, "状态标识和名称不能重复")
            require(0 < len(name) <= 50, "状态名称必填且不超过50字")
            require(state.get("category") in ["pending", "completed", "cancelled"], "状态类别无效")
            require(isinstance(state.get("initial"), bool), "初始状态设置无效")
            require(
                state.get("color")
                in [
                    "blue",
                    "red",
                    "orange",
                    "gold",
                    "green",
                    "purple",
                    "cyan",
                    "geekblue",
                    "default",
                ],
                "请选择预设状态颜色",
            )
            require(type(state.get("order")) is int and state["order"] >= 0, "状态顺序无效")
            codes.add(code)
            names.add(name)
            state["name"] = name
        require(len({state["order"] for state in states}) == len(states), "状态顺序不能重复")
        initials = [state for state in states if state["initial"]]
        require(
            len(initials) == 1 and initials[0]["category"] == "pending",
            "请选择唯一的未完成类别初始状态",
        )
        complete = {state["code"] for state in states if state["category"] == "completed"}
        require(bool(complete), "至少保留一个已完成类别状态")
        edges, pairs = spec.get("transitions", []), set()
        require(isinstance(edges, list) and len(edges) <= 10000, "流转路径无效")
        for edge in edges:
            a, b = edge.get("from"), edge.get("to")
            require(a in codes and b in codes and a != b, "下一流转状态必须是同类型其他有效状态")
            require(
                (a, b) not in pairs and isinstance(edge.get("enabled"), bool),
                "流转路径重复或开关无效",
            )
            pairs.add((a, b))
        seen = {initials[0]["code"]}
        for _ in states:
            seen.update(edge["to"] for edge in edges if edge["from"] in seen and edge["enabled"])
        require(bool(complete & seen), "须保留初始状态到完成状态的路径")
        if project:
            # Include recycled records: restoring an item must never produce a missing state.
            used = set(
                m.WorkItem.objects.filter(project=project, type=kind).values_list(
                    "status", "status_category"
                )
            )
            require(
                all(code in codes for code, category in used),
                "状态已被工作项使用，不能删除，请先流转相关工作项",
            )
            categories = {state["code"]: state["category"] for state in states}
            require(
                all(categories[code] == category for code, category in used),
                "已被工作项使用的状态不能修改类别",
            )
        states.sort(key=lambda state: state["order"])
        for index, state in enumerate(states):
            state["order"] = index
    return workflow


@transaction.atomic
def workflow_write(user, pid, data):
    if pid:
        obj = m.Project.objects.select_for_update().get(pk=pid, deleted_at=None)
        access(user, obj, manage=True)
        require_action(user, "workflow", "configure")
    else:
        require_action(user, "workflow-template", "configure")
        obj, _ = m.WorkflowTemplate.objects.get_or_create(
            key="default", defaults={"workflow": defaults()}
        )
        obj = m.WorkflowTemplate.objects.select_for_update().get(pk=obj.pk)
    version(obj, data)
    workflow = validate_workflow(data.get("workflow", {}), obj if pid else None)
    return save(user, obj, {"workflow": workflow}, "workflow")


def reminders():
    for event_id in m.NotificationEvent.objects.filter(delivered_at=None).values_list(
        "id", flat=True
    ):
        deliver_event(event_id)
    today = timezone.localdate()
    for item in m.WorkItem.objects.filter(
        deleted_at=None,
        project__status="active",
        due_date__lte=today + timedelta(days=1),
    ).exclude(status_category__in=["completed", "cancelled"]):
        if item.due_date == today + timedelta(days=1) or item.due_date < today:
            kind = "due" if item.due_date > today else "overdue"
            notify(
                item,
                kind,
                recipients=handler_ids(item),
                key=f"{item.pk}:{kind}:{today}",
            )


@transaction.atomic
def change_password(user, data):

    obj = m.User.objects.select_for_update().get(pk=user.pk)
    if not obj.must_change_password:
        require(obj.check_password(data.get("old_password", "")), "旧密码不正确")
    password = data.get("password", "")
    require(len(password) >= 10, "密码至少 10 位")
    require(not obj.check_password(password), "新密码不能与旧密码相同")
    obj.set_password(password)
    obj.must_change_password = False
    obj.version += 1
    obj.save()
    audit(obj, obj, "change_password")
    return obj


@transaction.atomic
def notifications_read(user, nid=None):
    qs = m.Notification.objects.filter(
        recipient=user, project__in=projects(user), item__deleted_at=None
    )
    if nid:
        obj = qs.get(pk=nid)
        if obj.read_at is None:
            obj.read_at = timezone.now()
            obj.version += 1
            obj.save()
            from .operation_logs import record

            record(user, obj, "read")
        return obj
    from .operation_logs import record

    if qs.filter(read_at=None).exists():
        record(user, user, "mark-all-read")
    qs.filter(read_at=None).update(read_at=timezone.now(), version=F("version") + 1)


def attachment_upload(user, parent, upload):
    import uuid
    from pathlib import Path

    from django.conf import settings

    require_action(user, "items" if isinstance(parent, m.WorkItem) else "documents", "upload")
    require(
        not isinstance(parent, m.Document) or parent.document_type == "markdown",
        "导入文档不支持编辑附件",
    )
    require(upload is not None, "请选择附件")
    require(upload.size <= settings.ATTACHMENT_MAX_BYTES, "附件超过大小限制")
    require(Path(upload.name).suffix.lower() in settings.ATTACHMENT_EXTENSIONS, "不允许此附件类型")
    obj = None
    try:
        with transaction.atomic():
            p = m.Project.objects.select_for_update().get(pk=parent.project_id)
            access(user, p, write=True)
            require(
                not type(parent).objects.get(pk=parent.pk).deleted_at,
                "已删除或无权访问",
                404,
                "NOT_FOUND",
            )
            field = "item" if isinstance(parent, m.WorkItem) else "document"
            original = Path(upload.name).name
            upload.name = f"{uuid.uuid4()}{Path(original).suffix.lower()}"
            obj = m.Attachment(
                project=p,
                uploaded_by=user,
                file=upload,
                original_name=original,
                size_bytes=upload.size,
                **{field: parent},
            )
            obj.save()
            audit(user, obj, "upload")
        return obj
    except Exception:
        if obj and obj.file and obj.file._committed:
            obj.file.delete(save=False)
        raise


def work_item_uploaded_attachments(item):
    """List uploaded files, excluding persistent and legacy rich-content images."""
    import re

    field = re.compile(r"/api/v1/attachments/([0-9a-f-]{36})\?inline=1")
    referenced = set(field.findall(item.description or ""))
    for body in m.Comment.objects.filter(item=item, deleted_at=None).values_list("body", flat=True):
        referenced.update(field.findall(body or ""))
    attachments = m.Attachment.objects.filter(item=item, deleted_at=None, is_inline_image=False)
    if referenced:
        attachments = attachments.exclude(pk__in=referenced)
    return attachments


@transaction.atomic
def attachment_delete(user, aid, data):
    obj = m.Attachment.objects.get(pk=aid, deleted_at=None)
    p = m.Project.objects.select_for_update().get(pk=obj.project_id)
    obj = m.Attachment.objects.select_for_update().get(pk=aid, deleted_at=None)
    access(user, p, write=True)
    require_action(user, "items" if obj.item_id else "documents", "delete_attachment")
    version(obj, data)
    require(
        obj.uploaded_by_id == user.id or role(user, p) == "admin",
        "只有上传者或管理员可删除附件",
        403,
        "FORBIDDEN",
    )
    return soft_delete(user, obj)


@transaction.atomic
def reorder_config(user, model, data, pid=None):
    p = None
    if model == m.Category or (model == m.Priority and pid):
        require(pid is not None, "请选择项目")
        p = m.Project.objects.select_for_update().get(pk=pid)
        access(user, p, manage=True)
    menu = (
        "items"
        if model == m.Category
        else "dictionaries"
        if p
        else "positions"
        if model == m.Position
        else "priorities"
    )
    require_action(user, menu, "categories" if model == m.Category else "reorder")
    require(model in [m.Position, m.Priority, m.Category], "不支持此配置排序")
    # Same lock order as config_write: serialize create, delete and reorder.
    list(m.UserGroup.objects.select_for_update().order_by("id"))
    options = model.objects.select_for_update().filter(deleted_at=None)
    if p:
        options = options.filter(project=p)
    if model == m.Priority:
        options = options.filter(project=p, kind=data.get("kind", "priority"))
    ordered = list(options.order_by("sort_order", "created_at", "id"))
    by_id = {str(obj.id): obj for obj in ordered}
    source = by_id.get(str(data["item_id"]))
    target = by_id.get(str(data["target_id"]))
    require(source is not None and target is not None, "记录已删除，请刷新后重试", 409, "CONFLICT")
    version(source, {"version": data["version"]})
    version(target, {"version": data["target_version"]})
    require(data.get("placement") in ["before", "after"], "拖动位置无效")
    if source.id == target.id:
        return ordered
    ordered.remove(source)
    index = ordered.index(target) + (1 if data["placement"] == "after" else 0)
    ordered.insert(index, source)
    for index, obj in enumerate(ordered):
        if obj.sort_order != index:
            save(user, obj, {"sort_order": index}, "reorder")
    return ordered


def write_record(user, data, writer):
    """Save a record, staged files and inline references as one transaction."""
    import re

    uploads = data.get("_uploads", [])
    created = []
    try:
        with transaction.atomic():
            obj = writer()
            field = "description" if isinstance(obj, m.WorkItem) else "body"
            content = getattr(obj, field)
            for token, upload in uploads:
                require(re.fullmatch(r"reqflow-upload:[0-9a-f-]{36}", token), "附件标识无效")
                attachment = attachment_upload(
                    user, obj.item if isinstance(obj, m.Comment) else obj, upload
                )
                if (
                    isinstance(obj, (m.WorkItem, m.Comment))
                    and token in content
                    and upload.content_type
                    and upload.content_type.startswith("image/")
                ):
                    attachment.is_inline_image = True
                    attachment.save(update_fields=["is_inline_image", "updated_at"])
                created.append(attachment)
                content = content.replace(token, f"/api/v1/attachments/{attachment.id}?inline=1")
            require("reqflow-upload:" not in content, "图片附件缺失，请重新选择图片")
            if content != getattr(obj, field):
                obj = save(user, obj, {field: content}, "update")
            return obj
    except Exception:
        for attachment in created:
            attachment.file.delete(save=False)
        raise
