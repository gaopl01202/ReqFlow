import csv
import io
import json
import uuid

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError
from django.db.models import Count, F, Q
from django.http import FileResponse, HttpResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.views import exception_handler as drf_handler

from . import models as m
from . import services as s
from .document_files import DOCUMENT_TYPES
from .notification_text import EVENT_LABELS
from .policies import (
    PERMISSIONS,
    PROJECT_MENUS,
    DomainError,
    access,
    action_permissions,
    admin,
    can_action,
    check_menu_route,
    menu_permissions,
    permission,
    projects,
    require,
    require_action,
    role,
)
from .querysets import iteration_rows, work_item_rows
from .schema import (
    CommandSerializer,
    ContractSchema,
    OrderedConfigCommandSerializer,
    ReorderSerializer,
)
from .serializers import serialize
from .sessions import session_state
from .workflow import STATES, defaults, normalized


def exception_handler(exc, context):
    rid = getattr(context.get("request"), "request_id", str(uuid.uuid4()))
    if isinstance(exc, DomainError):
        return Response(
            {
                "code": exc.code,
                "message": exc.message,
                "fields": exc.fields,
                "request_id": rid,
            },
            status=exc.status,
        )
    if isinstance(exc, ObjectDoesNotExist):
        return Response(
            {
                "code": "NOT_FOUND",
                "message": "已删除或无权访问",
                "fields": {},
                "request_id": rid,
            },
            status=404,
        )
    if isinstance(exc, (ValidationError, ValueError, TypeError, KeyError, IntegrityError)):
        return Response(
            {
                "code": "VALIDATION_ERROR",
                "message": "字段无效或唯一值冲突" if isinstance(exc, IntegrityError) else str(exc),
                "fields": getattr(exc, "message_dict", {}),
                "request_id": rid,
            },
            status=422,
        )
    response = drf_handler(exc, context)
    if response is not None:
        response.data = {
            "code": "FORBIDDEN" if response.status_code == 403 else "REQUEST_ERROR",
            "message": str(response.data.get("detail", "请求失败")),
            "fields": {},
            "request_id": rid,
        }
    if response is None:
        import logging

        logging.getLogger(__name__).error(
            "request_failed request_id=%s exception=%s", rid, type(exc).__name__
        )
        return Response(
            {
                "code": "INTERNAL_ERROR",
                "message": "服务暂时不可用，请稍后重试",
                "fields": {},
                "request_id": rid,
            },
            status=500,
        )
    return response


def page(qs, request):
    q = request.query_params
    if q.get("q"):
        names = [f.name for f in qs.model._meta.fields]
        query = Q()
        for name in ["title", "name", "number", "display_name", "username", "code"]:
            if name in names:
                query |= Q(**{name + "__icontains": q["q"]})
        if qs.model == m.Member:
            query |= Q(user__username__icontains=q["q"]) | Q(user__display_name__icontains=q["q"])
        elif qs.model == m.Notification:
            query |= Q(message__icontains=q["q"])
            query |= Q(
                event_type__in=[key for key, label in EVENT_LABELS.items() if q["q"] in label]
            )
        qs = qs.filter(query)
    fields = {f.name for f in qs.model._meta.fields}
    for name in [
        "type",
        "status",
        "priority",
        "assignee",
        "iteration",
        "category",
        "owner",
        "project",
        "group",
        "position",
        "is_active",
    ]:
        if name == "category" and qs.model == m.WorkItem and q.get(name) == "none":
            qs = qs.filter(category__isnull=True)
        elif q.get(name) and name in fields:
            qs = (
                qs.filter(Q(assignee=q[name]) | Q(handlers=q[name])).distinct()
                if qs.model == m.WorkItem and name == "assignee"
                else qs.filter(**{name: q[name]})
            )
    if qs.model == m.WorkItem:
        for key, lookup in [
            ("date_from", "created_at__date__gte"),
            ("date_to", "created_at__date__lte"),
            ("due_before", "due_date__lte"),
        ]:
            if q.get(key):
                qs = qs.filter(**{lookup: q[key]})
    size = min(max(int(q.get("page_size", 20)), 1), 100)
    number = max(int(q.get("page", 1)), 1)
    order = q.get("sort", "-created_at")
    if order.lstrip("-") not in fields:
        order = "-created_at"
    if not qs.ordered:
        qs = (
            qs.order_by("priority__sort_order", "-created_at")
            if qs.model == m.WorkItem and q.get("type") == "requirement"
            else qs.order_by(order)
        )
    if qs.model == m.WorkItem:
        qs = work_item_rows(qs)
    elif qs.model == m.Iteration:
        qs = iteration_rows(qs)
    return {
        "items": [
            serialize(o, iteration_details=False) for o in qs[(number - 1) * size : number * size]
        ],
        "total": qs.count(),
        "page": number,
        "page_size": size,
    }


def project(user, pid):
    return projects(user).get(pk=pid)


def item(user, iid, deleted=False):
    qs = m.WorkItem.objects.filter(project__in=projects(user))
    if not deleted:
        qs = qs.filter(deleted_at=None)
    return qs.get(pk=iid)


def report_items(p, request, include_created=True):
    qs = m.WorkItem.objects.filter(project=p, deleted_at=None)
    q = request.query_params
    if q.get("q"):
        qs = qs.filter(Q(title__icontains=q["q"]) | Q(number__icontains=q["q"]))
    for field in ["iteration", "type", "assignee", "priority", "category", "status"]:
        if q.get(field):
            qs = (
                qs.filter(Q(assignee=q[field]) | Q(handlers=q[field])).distinct()
                if field == "assignee"
                else qs.filter(**{field: q[field]})
            )
    for name, lookup in [
        ("date_from", "created_at__date__gte"),
        ("date_to", "created_at__date__lte"),
    ]:
        if include_created and q.get(name):
            qs = qs.filter(**{lookup: q[name]})
    return qs


def report(qs, request, completion_qs=None):
    base = qs.exclude(status_category="cancelled")
    total = base.count()
    done = base.filter(status_category="completed").count()
    members = []
    completion_qs = completion_qs if completion_qs is not None else qs
    member_ids = set(qs.values_list("handlers__id", flat=True)) | set(
        completion_qs.values_list("handlers__id", flat=True)
    )
    for uid in sorted(member_ids, key=lambda value: str(value or "")):
        part = qs.filter(handlers__id=uid).distinct()
        pending = part.exclude(status_category__in=["completed", "cancelled"])
        complete = completion_qs.filter(handlers__id=uid, completed_at__isnull=False).distinct()
        for name, lookup in [
            ("date_from", "completed_at__date__gte"),
            ("date_to", "completed_at__date__lte"),
        ]:
            if request.query_params.get(name):
                complete = complete.filter(**{lookup: request.query_params[name]})
        u = m.User.objects.filter(pk=uid).first() if uid else None
        members.append(
            {
                "id": str(uid) if uid else None,
                "name": u.display_name if u else "未分配",
                "unfinished": pending.count(),
                "overdue": pending.filter(due_date__lt=timezone.localdate()).count(),
                "completed": complete.count(),
            }
        )
    return {
        "total": total,
        "completed": done,
        "unfinished": base.exclude(status_category__in=["completed", "cancelled"]).count(),
        "completion_rate": done / total if total else None,
        "states": list(qs.values("type", "status").annotate(count=Count("id"))),
        "members": members,
        "severities": list(
            qs.filter(type="bug")
            .values(code=F("bugdetail__severity"))
            .annotate(count=Count("id", distinct=True))
            .order_by("code")
        ),
        "bugs": list(
            qs.filter(type="bug")
            .values("status", "bugdetail__severity")
            .annotate(assignee__display_name=F("handlers__display_name"))
            .values("status", "bugdetail__severity", "assignee__display_name")
            .annotate(count=Count("id", distinct=True))
        ),
    }


def report_table_export(project, qs, request, table):
    require(table in ["states", "members", "bugs"], "未知报表表格")
    data = report(qs, request, report_items(project, request, False))
    names = {"requirement": "需求", "task": "任务", "bug": "缺陷"}

    def state_name(kind, code):
        return next(
            (state["name"] for state in project.workflow[kind]["states"] if state["code"] == code),
            code,
        )

    if table == "states":
        headers = ["类型", "状态", "数量"]
        rows = [
            [names[row["type"]], state_name(row["type"], row["status"]), row["count"]]
            for row in data["states"]
        ]
    elif table == "members":
        headers = ["处理人", "未完成", "其中逾期", "本期完成"]
        rows = [
            [row[key] for key in ["name", "unfinished", "overdue", "completed"]]
            for row in data["members"]
        ]
    else:
        severity = dict(
            m.Priority.objects.filter(project=project, kind="severity").values_list("code", "name")
        )
        headers = ["状态", "严重程度", "处理人", "数量"]
        rows = [
            [
                state_name("bug", row["status"]),
                severity.get(row["bugdetail__severity"], row["bugdetail__severity"]),
                row["assignee__display_name"] or "未分配",
                row["count"],
            ]
            for row in data["bugs"]
        ]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(
            [
                ("'" + str(value))
                if str(value).startswith(("=", "+", "-", "@", "\t", "\r"))
                else value
                for value in row
            ]
        )
    response = HttpResponse("\ufeff" + output.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="reqflow-{table}.csv"'
    return response


class Endpoint(APIView):
    schema = ContractSchema()

    def get(self, request, **kwargs):
        return self.run(request, request.path.removeprefix("/api/v1/").rstrip("/"))

    def post(self, request, **kwargs):
        return self.run(request, request.path.removeprefix("/api/v1/").rstrip("/"))

    def patch(self, request, **kwargs):
        return self.run(request, request.path.removeprefix("/api/v1/").rstrip("/"))

    def delete(self, request, **kwargs):
        return self.run(request, request.path.removeprefix("/api/v1/").rstrip("/"))

    def run(self, r, path):
        parts = path.strip("/").split("/")
        method = r.method
        data = r.data if method != "GET" else {}
        user = r.user
        multipart_record = (
            "payload" in data
            and method in ["POST", "PATCH"]
            and (
                (parts[0] == "projects" and parts[-1] in ["work-items", "documents"])
                or (
                    parts[0] in ["work-items", "documents", "comments"]
                    and len(parts) == 2
                    and parts[1] != "bulk-update"
                )
                or (
                    parts[0] == "work-items"
                    and len(parts) == 3
                    and parts[2] in ["comments", "transition"]
                )
            )
        )
        if multipart_record:
            try:
                data = json.loads(data["payload"])
                require(isinstance(data, dict), "无效提交内容")
            except (ValueError, TypeError):
                raise DomainError("无效提交内容") from None
        if method != "GET" and (not r.FILES or multipart_record):
            serializer = (
                ReorderSerializer
                if parts[-1] == "reorder"
                else OrderedConfigCommandSerializer
                if (
                    parts[0] in ["positions", "priorities"]
                    or "categories" in parts
                    or "dictionaries" in parts
                )
                else CommandSerializer
            )
            command = serializer(data=data)
            if (
                (
                    parts[0] in ["positions", "priorities"]
                    or "categories" in parts
                    or "dictionaries" in parts
                )
                and parts[-1] != "reorder"
                and "sort_order" in data
            ):
                raise DomainError("请通过拖动调整顺序")
            if not command.is_valid():
                raise DomainError("请检查输入字段", fields=command.errors)
            data = command.validated_data
        if multipart_record:
            tokens = data.pop("upload_tokens", [])
            files = r.FILES.getlist("files")
            require(len(files) == len(tokens) and len(tokens) <= 20, "附件数量或标识无效")
            require(len(set(tokens)) == len(tokens), "附件标识重复")
            data["_uploads"] = list(zip(tokens, files, strict=True))
        actions = [
            "close",
            "reopen",
            "transition",
            "restore",
            "start",
            "finish",
            "activate",
            "deactivate",
            "reset-password",
            "mark-all-read",
            "bulk-update",
            "reorder",
            "login",
            "logout",
            "change-password",
        ]
        if parts[-1] in actions:
            require(method == "POST", "请求方法不允许", 405, "METHOD_NOT_ALLOWED")
        if path == "health":
            from django.db import connection

            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            return Response({"status": "ok"})
        if path == "auth/csrf":
            return Response({"csrf_token": get_token(r)})
        if path == "auth/login" and method == "POST":
            # SessionAuthentication cannot enforce CSRF for anonymous requests.
            from django.middleware.csrf import CsrfViewMiddleware

            failure = CsrfViewMiddleware(lambda req: None).process_view(
                r._request, lambda req: None, (), {}
            )
            require(failure is None, "CSRF 校验失败", 403, "FORBIDDEN")
            candidate = m.User.objects.filter(
                username=data.get("username"), deleted_at=None
            ).first()
            require(
                candidate is not None
                and candidate.is_active
                and (candidate.is_superuser or candidate.group and candidate.group.enabled),
                "账号不可用",
                401,
                "UNAUTHENTICATED",
            )
            authenticated = authenticate(
                r, username=data.get("username"), password=data.get("password")
            )
            require(authenticated is not None, "账号或密码错误", 401, "UNAUTHENTICATED")
            login(r, authenticated)
            from .operation_logs import record

            record(authenticated, authenticated, "login")
            return Response(serialize(authenticated))
        require(
            bool(user and user.is_authenticated and user.is_active and not user.deleted_at),
            "请先登录",
            401,
            "UNAUTHENTICATED",
        )
        require(
            admin(user) or user.group and user.group.enabled,
            "用户组不可用",
            403,
            "FORBIDDEN",
        )
        if path == "auth/logout" and method == "POST":
            from .operation_logs import record

            record(user, user, "logout")
            logout(r)
            return Response(status=204)
        if path == "auth/me":
            return Response(
                {
                    **serialize(user),
                    "permissions": [code for code in PERMISSIONS if permission(user, code)],
                    "action_permissions": action_permissions(user),
                    **session_state(r),
                    "session_idle_timeout_seconds": settings.SESSION_IDLE_TIMEOUT_SECONDS,
                    "menu_permissions": menu_permissions(user),
                    "attachment_max_bytes": settings.ATTACHMENT_MAX_BYTES,
                    "attachment_extensions": settings.ATTACHMENT_EXTENSIONS,
                    "document_max_bytes": settings.DOCUMENT_MAX_BYTES,
                    "document_extensions": sorted(DOCUMENT_TYPES),
                }
            )
        if path == "auth/activity" and method == "POST":
            from .sessions import session_activity

            session_activity(r)
            return Response(session_state(r))
        if path == "auth/change-password" and method == "POST":
            obj = s.change_password(user, data)
            update_session_auth_hash(r, obj)
            return Response(serialize(obj))
        require(
            not user.must_change_password,
            "首次登录请先修改密码",
            403,
            "PASSWORD_CHANGE_REQUIRED",
        )
        check_menu_route(user, parts, method)
        if path == "operation-logs" and method == "GET":
            from .operation_logs import listing

            require(
                "operation-logs" in menu_permissions(user),
                "没有运行日志的查看权限",
                403,
                "FORBIDDEN",
            )
            return Response(listing(r))
        if parts[0] == "links" and method == "GET":
            import re

            from .links import web_url

            p = projects(user).get(code=parts[1])
            kind, reference = parts[2:4]
            if kind in ["requirement", "task", "bug"]:
                require(
                    re.fullmatch(r"[1-9][0-9]*", reference) is not None,
                    "链接无效",
                    404,
                    "NOT_FOUND",
                )
                check_menu_route(user, ["work-items", reference], "GET")
                number = (
                    f"{p.code}-"
                    + {"requirement": "R", "task": "T", "bug": "B"}[kind]
                    + f"-{reference}"
                )
                obj = m.WorkItem.objects.get(project=p, type=kind, number=number, deleted_at=None)
            else:
                require(kind in ["document", "iteration"], "链接无效", 404, "NOT_FOUND")
                require(
                    re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", reference)
                    is not None,
                    "链接无效",
                    404,
                    "NOT_FOUND",
                )
                check_menu_route(
                    user, ["documents" if kind == "document" else "iterations", reference], "GET"
                )
                obj = (m.Document if kind == "document" else m.Iteration).objects.get(
                    project=p, pk=reference, deleted_at=None
                )
            return Response(
                {
                    "id": str(obj.id),
                    "project": str(p.id),
                    "project_code": p.code,
                    "type": kind,
                    "web_url": web_url(obj),
                }
            )
        if path == "workspace/context" and method == "GET":
            require(
                any(key in menu_permissions(user) for key in ["users", "user-groups", "positions"]),
                "没有系统菜单访问权限",
                403,
                "FORBIDDEN",
            )
            return Response(
                {
                    "positions": list(
                        m.Position.objects.filter(deleted_at=None).values("id", "name", "enabled")
                    ),
                    "groups": list(
                        m.UserGroup.objects.filter(deleted_at=None).values(
                            "id", "name", "enabled", "builtin"
                        )
                    ),
                }
            )
        if path == "directory" and method == "GET":
            return Response(
                {
                    "items": [
                        {"id": str(u.id), "display_name": u.display_name}
                        for u in m.User.objects.filter(is_active=True, deleted_at=None)
                    ]
                }
            )
        if parts[0] == "users":
            if method == "GET" and "users" not in menu_permissions(user):
                require(admin(user), "需要系统管理员", 403, "FORBIDDEN")
            if method == "GET":
                qs = m.User.objects.filter(deleted_at=None).order_by(
                    "display_name", "username", "id"
                )
                return Response(serialize(qs.get(pk=parts[1])) if len(parts) > 1 else page(qs, r))
            obj, temp = s.user_write(
                user,
                data,
                parts[1] if len(parts) > 1 else None,
                parts[2] if len(parts) > 2 else "delete" if method == "DELETE" else None,
            )
            if method == "DELETE":
                return Response(status=204)
            response = Response(
                {**serialize(obj), **({"temporary_password": temp} if temp else {})},
                status=201 if len(parts) == 1 else 200,
            )
            response["Cache-Control"] = "no-store"
            return response
        if parts[0] == "dictionaries" or (
            parts[0] == "projects" and len(parts) > 2 and parts[2] == "dictionaries"
        ):
            p = None
            index = 1
            if parts[0] == "projects":
                p = m.Project.objects.get(pk=parts[1], deleted_at=None)
                access(user, p)
                index = 3
            else:
                if method == "GET" and "priorities" not in menu_permissions(user):
                    require(admin(user), "需要系统管理员", 403, "FORBIDDEN")
            kind = r.query_params.get("kind", data.get("kind", "priority"))
            require(kind in s.DICTIONARY_KINDS, "未知字典类型")
            if len(parts) > index and parts[index] == "reorder":
                s.reorder_config(user, m.Priority, {**data, "kind": kind}, p.pk if p else None)
            elif method != "GET":
                obj = s.config_write(
                    user,
                    m.Priority,
                    {**data, "kind": kind},
                    parts[index] if len(parts) > index else None,
                    p.pk if p else None,
                    method == "DELETE",
                )
                return (
                    Response(status=204)
                    if method == "DELETE"
                    else Response(serialize(obj), status=200 if len(parts) > index else 201)
                )
            qs = m.Priority.objects.filter(project=p, kind=kind, deleted_at=None).order_by(
                "sort_order", "created_at", "id"
            )
            if method == "GET" and len(parts) > index:
                return Response(serialize(qs.get(pk=parts[index])))
            return Response(page(qs, r))
        if parts[0] == "workflow-template":
            if method == "GET" and "workflow-template" not in menu_permissions(user):
                require(admin(user), "需要系统管理员", 403, "FORBIDDEN")
            if method == "GET":
                template = m.WorkflowTemplate.objects.filter(key="default").first()
                return Response(
                    {
                        "workflow": normalized(template.workflow if template else defaults()),
                        "version": template.version if template else 1,
                    }
                )
            template = s.workflow_write(user, None, data)
            return Response({"workflow": template.workflow, "version": template.version})
        if path == "recycle-bin" and method == "GET":
            qs = (
                m.WorkItem.objects.filter(project__in=projects(user), deleted_at__isnull=False)
                .select_related("project")
                .order_by("-deleted_at", "-id")
            )
            result = page(qs, r)
            ids = [row["id"] for row in result["items"]]
            project_ids = {row["project"] for row in result["items"]}
            deleted_by = {
                audit.entity_id: audit.actor.display_name if audit.actor_id else "—"
                for audit in m.Audit.objects.filter(
                    entity_id__in=ids, project_id__in=project_ids, action="delete"
                )
                .select_related("actor")
                .order_by("created_at")
            }
            row_projects = {row["id"]: row["project"] for row in result["items"]}
            accessible_projects = {
                str(project.id): project for project in projects(user).filter(id__in=project_ids)
            }
            for row in result["items"]:
                row["deleted_by_name"] = deleted_by.get(row["id"], "—")
                p = accessible_projects.get(str(row_projects[row["id"]]))
                row["project_name"] = p.name if p else "—"
                row["can_restore"] = bool(
                    p and role(user, p) == "admin" and can_action(user, "recycle-bin", "restore")
                )
            return Response(result)
        global_models = {
            "user-groups": m.UserGroup,
            "positions": m.Position,
            "priorities": m.Priority,
        }
        if parts[0] in global_models:
            model = global_models[parts[0]]
            if len(parts) == 2 and parts[1] == "reorder":
                s.reorder_config(user, model, data)
                return Response(
                    page(
                        model.objects.filter(deleted_at=None).order_by(
                            "sort_order", "created_at", "id"
                        ),
                        r,
                    )
                )
            if parts[0] == "user-groups" and (
                method == "GET" and "user-groups" not in menu_permissions(user)
            ):
                require(admin(user), "需要系统管理员", 403, "FORBIDDEN")
            if method == "GET":
                qs = model.objects.filter(deleted_at=None)
                if model == m.Priority:
                    qs = qs.filter(project=None, kind="priority")
                if model in [m.Position, m.Priority]:
                    qs = qs.order_by("sort_order", "created_at", "id")
                return Response(serialize(qs.get(pk=parts[1])) if len(parts) > 1 else page(qs, r))
            obj = s.config_write(
                user,
                model,
                data,
                parts[1] if len(parts) > 1 else None,
                delete=method == "DELETE",
            )
            return (
                Response(status=204)
                if method == "DELETE"
                else Response(serialize(obj), status=201 if len(parts) == 1 else 200)
            )
        if parts[0] == "projects" and len(parts) == 1:
            if method == "GET":
                result = page(projects(user), r)
                for row in result["items"]:
                    row["current_role"] = role(user, m.Project.objects.get(pk=row["id"]))
                return Response(result)
            return Response(serialize(s.create_project(user, data)), status=201)
        if parts[0] == "projects":
            p = project(user, parts[1])
            if len(parts) > 2 and parts[2] == "context" and method == "GET":
                require(
                    any(key in menu_permissions(user) for key in PROJECT_MENUS + ["home"]),
                    "没有项目菜单访问权限",
                    403,
                    "FORBIDDEN",
                )
                return Response(
                    {
                        "project": serialize(p),
                        "members": [
                            serialize(obj)
                            for obj in m.Member.objects.filter(
                                project=p, deleted_at=None
                            ).select_related("user__position")
                        ],
                        "iterations": [
                            serialize(obj, iteration_details=False)
                            for obj in iteration_rows(
                                m.Iteration.objects.filter(project=p, deleted_at=None)
                            )
                        ],
                        "categories": [
                            serialize(obj)
                            for obj in m.Category.objects.filter(
                                project=p, deleted_at=None
                            ).order_by("sort_order")
                        ],
                        "workflow": {"workflow": normalized(p.workflow), "version": p.version},
                        "dictionaries": [
                            serialize(obj)
                            for obj in m.Priority.objects.filter(
                                project=p, deleted_at=None
                            ).order_by("sort_order")
                        ],
                    }
                )
            if len(parts) == 2:
                return (
                    Response(serialize(p))
                    if method == "GET"
                    else Response(serialize(s.update_project(user, p.pk, data)))
                )
            section = parts[2]
            if section in ["close", "reopen"]:
                return Response(serialize(s.update_project(user, p.pk, data, section)))
            if section == "members":
                if method == "GET":
                    return Response(
                        page(
                            m.Member.objects.filter(project=p, deleted_at=None).select_related(
                                "user__position"
                            ),
                            r,
                        )
                    )
                if len(parts) == 4 and parts[3] in ["bulk", "bulk-delete"]:
                    require(method == "POST", "请求方法不允许", 405, "METHOD_NOT_ALLOWED")
                    entries = data.get("users", []) if parts[3] == "bulk" else data.get("items", [])
                    require(
                        isinstance(entries, list) and 0 < len(entries) <= 100, "请选择1至100名成员"
                    )
                    succeeded, failed = [], []
                    for entry in entries:
                        try:
                            if parts[3] == "bulk":
                                s.member_write(
                                    user,
                                    p.pk,
                                    {"user": entry, "role": data.get("role", "member")},
                                )
                                succeeded.append(str(entry))
                            else:
                                s.member_write(
                                    user,
                                    p.pk,
                                    {
                                        "version": entry.get("version"),
                                        "unfinished_items": {"action": "unassign"},
                                    },
                                    entry.get("user"),
                                    True,
                                )
                                succeeded.append(str(entry.get("user")))
                        except (
                            DomainError,
                            ObjectDoesNotExist,
                            ValidationError,
                            IntegrityError,
                        ) as exc:
                            message = exc.message if isinstance(exc, DomainError) else str(exc)
                            failed.append(
                                {
                                    "id": str(entry if parts[3] == "bulk" else entry.get("user")),
                                    "message": message,
                                }
                            )
                    return Response(
                        {
                            "succeeded": succeeded,
                            "failed": failed,
                            "success_count": len(succeeded),
                            "failure_count": len(failed),
                        },
                        status=200,
                    )
                obj = s.member_write(
                    user, p.pk, data, parts[3] if len(parts) > 3 else None, method == "DELETE"
                )
                return (
                    Response(status=204)
                    if method == "DELETE"
                    else Response(serialize(obj), status=201 if len(parts) == 3 else 200)
                )
            if section in ["work-items", "recycle-bin"]:
                if method == "POST":
                    return Response(
                        serialize(
                            s.write_record(user, data, lambda: s.create_item(user, p.pk, data))
                        ),
                        status=201,
                    )
                qs = m.WorkItem.objects.filter(project=p)
                if section == "recycle-bin":
                    qs = qs.filter(deleted_at__isnull=False).order_by("-deleted_at", "-id")
                else:
                    qs = qs.filter(deleted_at=None)
                result = page(qs, r)
                if section == "recycle-bin":
                    ids = [row["id"] for row in result["items"]]
                    deleted_by = {
                        audit.entity_id: audit.actor.display_name if audit.actor_id else "—"
                        for audit in m.Audit.objects.filter(
                            entity_id__in=ids, action="delete", project=p
                        )
                        .select_related("actor")
                        .order_by("created_at")
                    }
                    for row in result["items"]:
                        row["deleted_by_name"] = deleted_by.get(row["id"], "—")
                        row["project_name"] = p.name
                        row["can_restore"] = role(user, p) == "admin" and can_action(
                            user, "recycle-bin", "restore"
                        )
                return Response(result)
            if section == "iterations":
                if method == "GET":
                    return Response(page(m.Iteration.objects.filter(project=p, deleted_at=None), r))
                return Response(serialize(s.iteration_write(user, p.pk, data)), status=201)
            if section == "documents":
                if len(parts) == 4 and parts[3] == "import":
                    from .document_files import import_document

                    return Response(
                        serialize(
                            import_document(user, p.pk, r.FILES.get("file"), data.get("parent"))
                        ),
                        status=201,
                    )
                if method == "GET":
                    records, ancestors = s.document_listing(user, p, r.query_params.get("parent"))
                    return Response({**page(records, r), "ancestors": ancestors})
                return Response(
                    serialize(
                        s.write_record(user, data, lambda: s.document_write(user, p.pk, data))
                    ),
                    status=201,
                )
            if section == "categories":
                if len(parts) > 3 and parts[3] == "reorder":
                    s.reorder_config(user, m.Category, data, p.pk)
                    return Response(
                        page(
                            m.Category.objects.filter(project=p, deleted_at=None).order_by(
                                "sort_order", "created_at", "id"
                            ),
                            r,
                        )
                    )
                if method == "GET":
                    return Response(
                        page(
                            m.Category.objects.filter(project=p, deleted_at=None).order_by(
                                "sort_order", "created_at", "id"
                            ),
                            r,
                        )
                    )
                obj = s.config_write(
                    user,
                    m.Category,
                    data,
                    parts[3] if len(parts) > 3 else None,
                    p.pk,
                    method == "DELETE",
                )
                return (
                    Response(status=204)
                    if method == "DELETE"
                    else Response(serialize(obj), status=201 if len(parts) == 3 else 200)
                )
            if section == "workflow":
                if method == "GET":
                    return Response({"workflow": normalized(p.workflow), "version": p.version})
                return Response(serialize(s.workflow_write(user, p.pk, data)))
            if section == "board":
                kind = r.query_params.get("type", "task")
                require(kind in STATES, "工作项类型无效")
                qs = (
                    report_items(p, r)
                    .filter(type=kind)
                    .exclude(status_category="cancelled")
                    .order_by("priority__sort_order", "due_date", "created_at")
                )
                return Response(
                    {
                        "columns": [
                            {
                                **state,
                                "items": [serialize(o) for o in qs.filter(status=state["code"])],
                            }
                            for state in sorted(
                                p.workflow[kind]["states"], key=lambda x: x["order"]
                            )
                        ]
                    }
                )
            if section == "reports":
                require(permission(user, "view_reports"), "无报表权限", 403, "FORBIDDEN")
                qs = report_items(p, r)
                if parts[3] == "export":
                    require_action(user, "reports", "export")
                    access(user, p, export=True)
                    if "table" in r.query_params:
                        response = report_table_export(p, qs, r, r.query_params["table"])
                        from .operation_logs import record

                        record(user, p, "export")
                        return response
                    out = io.StringIO()
                    writer = csv.writer(out)
                    writer.writerow(
                        ["编号", "类型", "标题", "状态", "负责人", "优先级", "截止日期"]
                    )

                    def safe(value):
                        value = str(value or "")
                        return (
                            "'" + value
                            if value.startswith(("=", "+", "-", "@", "\t", "\r"))
                            else value
                        )

                    for o in qs:
                        writer.writerow(
                            [
                                safe(v)
                                for v in [
                                    o.number,
                                    {"task": "任务", "requirement": "需求", "bug": "缺陷"}[o.type],
                                    o.title,
                                    next(
                                        (
                                            st["name"]
                                            for st in p.workflow[o.type]["states"]
                                            if st["code"] == o.status
                                        ),
                                        o.status,
                                    ),
                                    serialize(o)["assignee_name"] or "",
                                    o.priority.name,
                                    o.due_date,
                                ]
                            ]
                        )
                    response = HttpResponse(
                        "\ufeff" + out.getvalue(),
                        content_type="text/csv; charset=utf-8",
                    )
                    response["Content-Disposition"] = 'attachment; filename="reqflow.csv"'
                    from .operation_logs import record

                    record(user, p, "export")
                    return response
                return Response(report(qs, r, report_items(p, r, False)))
        if path == "work-items/bulk-update" and method == "POST":
            require_action(user, "items", "bulk")
            succeeded = []
            failed = []
            require(
                isinstance(data.get("items"), list) and len(data["items"]) <= 100,
                "批量上限 100 条",
            )
            for entry in data["items"]:
                try:
                    values = {
                        k: v
                        for k, v in data.get("changes", {}).items()
                        if k in ["assignee", "priority", "iteration"]
                    }
                    s.update_item(
                        user, entry["id"], {**values, "version": entry.get("version")}, "bulk"
                    )
                    succeeded.append(entry["id"])
                except (
                    DomainError,
                    ObjectDoesNotExist,
                    ValidationError,
                    IntegrityError,
                ) as exc:
                    failed.append(
                        {
                            "id": entry.get("id"),
                            "code": getattr(exc, "code", "VALIDATION_ERROR"),
                            "message": getattr(exc, "message", str(exc)),
                        }
                    )
            return Response(
                {
                    "succeeded": succeeded,
                    "failed": failed,
                    "success_count": len(succeeded),
                    "failure_count": len(failed),
                }
            )
        if parts[0] == "work-items":
            obj = item(user, parts[1], len(parts) > 2 and parts[2] == "restore")
            if len(parts) == 2:
                if method == "GET":
                    return Response(serialize(obj))
                result = s.write_record(
                    user,
                    data,
                    lambda: s.update_item(
                        user, obj.pk, data, "delete" if method == "DELETE" else None
                    ),
                )
                return Response(status=204) if method == "DELETE" else Response(serialize(result))
            section = parts[2]
            if section in ["transition", "restore"]:
                return Response(serialize(s.update_item(user, obj.pk, data, section)))
            if section == "history":
                return Response(
                    page(
                        m.Audit.objects.filter(
                            Q(entity_id=str(obj.pk))
                            | Q(
                                entity_type="Comment",
                                entity_id__in=[
                                    str(v)
                                    for v in m.Comment.objects.filter(item=obj).values_list(
                                        "id", flat=True
                                    )
                                ],
                            )
                            | Q(
                                entity_type="Attachment",
                                entity_id__in=[
                                    str(v)
                                    for v in m.Attachment.objects.filter(item=obj).values_list(
                                        "id", flat=True
                                    )
                                ],
                            )
                        ),
                        r,
                    )
                )
            if section == "comments":
                if method == "GET":
                    return Response(
                        page(
                            m.Comment.objects.filter(item=obj, deleted_at=None).order_by(
                                "-created_at", "-id"
                            ),
                            r,
                        )
                    )
                return Response(
                    serialize(
                        s.write_record(user, data, lambda: s.comment_write(user, obj.pk, data))
                    ),
                    status=201,
                )
            if section == "attachments":
                return self.attachments(r, obj, data)
        if parts[0] == "comments":
            comment = m.Comment.objects.get(pk=parts[1], deleted_at=None)
            item(user, comment.item_id)
            result = (
                s.comment_write(user, comment.item_id, data, comment.pk, True)
                if method == "DELETE"
                else s.write_record(
                    user, data, lambda: s.comment_write(user, comment.item_id, data, comment.pk)
                )
            )
            return Response(status=204) if method == "DELETE" else Response(serialize(result))
        if parts[0] == "iterations":
            obj = m.Iteration.objects.get(pk=parts[1], project__in=projects(user), deleted_at=None)
            if len(parts) > 2 and parts[2] == "reports":
                require(permission(user, "view_reports"), "无报表权限", 403, "FORBIDDEN")
                return Response(
                    report(
                        report_items(obj.project, r).filter(iteration=obj),
                        r,
                        report_items(obj.project, r, False).filter(iteration=obj),
                    )
                )
            if len(parts) > 2 and parts[2] == "work-items":
                target = item(user, parts[3])
                require(target.project_id == obj.project_id, "不能跨项目关联")
                require(obj.status != "finished", "已结束迭代不可修改归属")
                if method == "DELETE":
                    require(target.iteration_id == obj.id, "工作项不属于此迭代")
                return Response(
                    serialize(
                        s.update_item(
                            user,
                            target.pk,
                            {
                                "version": data.get("version"),
                                "iteration": str(obj.pk) if method == "POST" else None,
                            },
                            "iteration_assign",
                        )
                    )
                )
            if method == "GET":
                return Response(serialize(obj))
            return Response(
                serialize(
                    s.iteration_write(
                        user,
                        obj.project_id,
                        data,
                        obj.pk,
                        parts[2] if len(parts) > 2 else None,
                    )
                )
            )
        if parts[0] == "documents":
            obj = m.Document.objects.get(pk=parts[1], project__in=projects(user), deleted_at=None)
            if len(parts) > 2 and parts[2] == "attachments":
                return self.attachments(r, obj, data)
            if len(parts) > 2 and parts[2] in ["download", "preview"]:
                require(
                    obj.document_type != "markdown" and bool(obj.source_file),
                    "此文档没有导入文件",
                    404,
                    "NOT_FOUND",
                )
                download = parts[2] == "download"
                if download:
                    require_action(user, "documents", "download")
                content_type = {
                    "pdf": "application/pdf",
                    "txt": "text/plain",
                    "csv": "text/csv",
                }.get(obj.document_type, "application/octet-stream")
                response = FileResponse(
                    obj.source_file.open("rb"),
                    as_attachment=download,
                    filename=obj.original_name,
                    content_type="application/octet-stream" if download else content_type,
                )
                if download:
                    from .operation_logs import record

                    record(user, obj, "download")
                response["X-Content-Type-Options"] = "nosniff"
                response["X-Frame-Options"] = "SAMEORIGIN"
                response["Cache-Control"] = "private, no-store"
                return response
            if method == "GET":
                return Response(serialize(obj))
            result = s.write_record(
                user,
                data,
                lambda: s.document_write(user, obj.project_id, data, obj.pk, method == "DELETE"),
            )
            return Response(status=204) if method == "DELETE" else Response(serialize(result))
        if parts[0] == "attachments":
            obj = m.Attachment.objects.get(pk=parts[1], project__in=projects(user), deleted_at=None)
            parent = obj.item or obj.document
            scope = "items" if obj.item_id else "documents"
            require(
                admin(user)
                or scope in menu_permissions(user)
                or (scope == "items" and "home" in menu_permissions(user)),
                "没有此附件所属菜单的访问权限",
                403,
                "FORBIDDEN",
            )
            require(not parent.deleted_at, "已删除或无权访问", 404, "NOT_FOUND")
            if method == "GET" and parts[-1] == "metadata":
                return Response(serialize(obj))
            if method == "GET":
                import mimetypes
                from pathlib import Path

                if r.query_params.get("preview") != "1" and r.query_params.get("inline") != "1":
                    require_action(user, "items" if obj.item_id else "documents", "download")
                inline = r.query_params.get("inline") == "1" and Path(
                    obj.original_name
                ).suffix.lower() in [".png", ".jpg", ".jpeg"]
                response = FileResponse(
                    obj.file.open("rb"),
                    as_attachment=not inline,
                    filename=obj.original_name,
                    content_type=mimetypes.guess_type(obj.original_name)[0]
                    if inline
                    else "application/octet-stream",
                )
                response["X-Content-Type-Options"] = "nosniff"
                if r.query_params.get("preview") != "1" and r.query_params.get("inline") != "1":
                    from .operation_logs import record

                    record(user, obj, "download")
                return response
            s.attachment_delete(user, obj.pk, data)
            return Response(status=204)
        if parts[:1] == ["me"]:
            visible = projects(user)
            if parts[1] in ["todos", "dashboard"]:
                qs = (
                    m.WorkItem.objects.filter(
                        project__in=visible,
                        project__status="active",
                        deleted_at=None,
                    )
                    .filter(Q(assignee=user) | Q(handlers=user))
                    .distinct()
                    .exclude(status_category__in=["completed", "cancelled"])
                )
                if parts[1] == "todos":
                    scope = r.query_params.get("todo_scope", "all")
                    require(scope in ["all", "today", "overdue"], "未知待办范围")
                    if scope == "today":
                        qs = qs.filter(due_date=timezone.localdate())
                    elif scope == "overdue":
                        qs = qs.filter(due_date__lt=timezone.localdate())
                    return Response(page(qs.order_by("due_date", "-updated_at"), r))
                return Response(
                    {
                        "unfinished": qs.count(),
                        "due_today": qs.filter(due_date=timezone.localdate()).count(),
                        "overdue": qs.filter(due_date__lt=timezone.localdate()).count(),
                        "projects": visible.count(),
                        "types": list(qs.values("type").annotate(count=Count("id", distinct=True))),
                        "project_progress": [
                            {
                                "id": str(p.pk),
                                "name": p.name,
                                "member_count": m.Member.objects.filter(
                                    project=p, deleted_at=None
                                ).count(),
                                "total": m.WorkItem.objects.filter(project=p, deleted_at=None)
                                .exclude(status_category="cancelled")
                                .count(),
                                "completed": m.WorkItem.objects.filter(
                                    project=p, deleted_at=None, status_category="completed"
                                ).count(),
                                "unfinished": qs.filter(project=p).count(),
                            }
                            for p in visible.order_by("-updated_at")[:6]
                        ],
                        "activity": page(
                            m.Audit.objects.filter(
                                project__in=visible,
                                action__in=[
                                    "create",
                                    "assignment",
                                    "transition",
                                    "comment",
                                    "handover",
                                ],
                            ),
                            r,
                        )["items"],
                    }
                )
            if parts[1] == "notifications":
                qs = m.Notification.objects.filter(
                    recipient=user, project__in=visible, item__deleted_at=None
                )
                if len(parts) > 2 and parts[2] == "mark-all-read":
                    s.notifications_read(user)
                    return Response({"ok": True})
                return Response(page(qs, r))
        if parts[0] == "notifications":
            obj = m.Notification.objects.get(
                pk=parts[1],
                recipient=user,
                project__in=projects(user),
                item__deleted_at=None,
            )
            return Response(serialize(s.notifications_read(user, obj.pk)))
        raise DomainError("接口不存在", 404, "NOT_FOUND")

    def attachments(self, r, parent, data):
        field = "item" if isinstance(parent, m.WorkItem) else "document"
        if r.method == "GET":
            attachments = (
                s.work_item_uploaded_attachments(parent)
                if isinstance(parent, m.WorkItem)
                else m.Attachment.objects.filter(**{field: parent}, deleted_at=None)
            )
            return Response(page(attachments, r))
        obj = s.attachment_upload(r.user, parent, r.FILES.get("file"))
        return Response(serialize(obj), status=201)
