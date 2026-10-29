import json
from pathlib import Path

from .models import Member, Project

PERMISSIONS = [
    "system_settings",
    "manage_users",
    "create_project",
    "view_all_projects",
    "manage_members",
    "manage_items",
    "view_project",
    "edit_items",
    "view_reports",
    "export",
]
DEFAULT_PERMISSIONS = [
    "create_project",
    "manage_members",
    "manage_items",
    "view_project",
    "edit_items",
    "view_reports",
    "export",
]


MENU_CATALOG = json.loads(Path(__file__).with_name("menu-catalog.json").read_text())
MENU_KEYS = [item["key"] for section in MENU_CATALOG for item in section["items"]]
PROJECT_MENUS = MENU_KEYS[2:10]
ACTION_CATALOG = json.loads(Path(__file__).with_name("action-catalog.json").read_text())
ACTION_KEYS = [f"{menu}:{code}" for menu, entries in ACTION_CATALOG.items() for code, _ in entries]
SYSTEM_MENUS = MENU_KEYS[10:]


def action_permissions(user):
    if admin(user):
        return ACTION_KEYS
    if not user.group_id or not user.group.enabled:
        return []
    return group_action_permissions(user.group)


def group_action_permissions(group):
    if group.builtin and group.name == "系统管理员":
        return ACTION_KEYS
    if group.action_permissions is not None:
        return group.action_permissions
    # Preserve existing functional access until a group is explicitly configured.
    legacy = group.permissions
    allowed = []
    for key in ACTION_KEYS:
        menu, operation = key.split(":")
        if menu in SYSTEM_MENUS:
            continue
        if menu == "projects":
            enabled = (
                "create_project" in legacy if operation == "create" else "manage_members" in legacy
            )
        elif menu == "reports":
            enabled = "export" in legacy
        elif menu in ["members", "dictionaries", "workflow", "iterations"] or key in [
            "items:categories",
            "recycle-bin:restore",
        ]:
            enabled = "manage_members" in legacy
        elif operation == "download":
            enabled = "view_project" in legacy
        else:
            enabled = "edit_items" in legacy
        if enabled:
            allowed.append(key)
    return allowed


def can_action(user, menu, operation):
    return admin(user) or (
        bool(user.group_id)
        and user.is_active
        and not user.deleted_at
        and (user.group.action_permissions is None or menu in menu_permissions(user))
        and f"{menu}:{operation}" in action_permissions(user)
    )


def require_action(user, menu, operation):
    require(can_action(user, menu, operation), "没有此功能的操作权限", 403, "FORBIDDEN")


def menu_permissions(user):
    if admin(user):
        return MENU_KEYS
    if not user.group_id or not user.group.enabled:
        return []
    if user.group.menu_permissions is not None:
        return user.group.menu_permissions
    return [key for key in MENU_KEYS[:10] if key != "reports" or permission(user, "view_reports")]


def check_menu_route(user, parts, method):
    # Null is the compatibility mode: existing groups keep their prior API behavior.
    if admin(user) or user.group.menu_permissions is None:
        return
    root = parts[0]
    if root == "operation-logs":
        require(
            "operation-logs" in menu_permissions(user), "没有此菜单的访问权限", 403, "FORBIDDEN"
        )
        return
    keys = None
    if root in [
        "users",
        "user-groups",
        "positions",
        "workflow-template",
        "dictionaries",
        "priorities",
    ]:
        keys = [{"dictionaries": "priorities"}.get(root, root)]
    elif root == "me" and parts[1] in ["dashboard", "todos"]:
        keys = ["home"]
    elif root == "projects" and len(parts) == 1 and method != "GET":
        keys = ["projects"]
    elif root == "projects" and len(parts) > 2:
        section = parts[2]
        key = {"work-items": "items", "board": "items", "categories": "items"}.get(section, section)
        if section != "context":
            keys = [key]
    elif root == "work-items":
        keys = ["recycle-bin"] if "restore" in parts else ["items", "home"]
    elif root == "recycle-bin":
        keys = ["recycle-bin"]
    elif root == "iterations":
        keys = ["iterations"]
    elif root == "documents":
        keys = ["documents"]
    elif root == "comments":
        keys = ["items", "home"]
    elif root == "attachments":
        keys = ["items", "home", "documents"]
    if keys:
        require(
            any(key in menu_permissions(user) for key in keys),
            "没有此菜单的访问权限",
            403,
            "FORBIDDEN",
        )


class DomainError(Exception):
    def __init__(self, message, status=422, code="VALIDATION_ERROR", fields=None):
        self.message, self.status, self.code, self.fields = (
            message,
            status,
            code,
            fields or {},
        )


def require(condition, message, status=422, code="VALIDATION_ERROR"):
    if not condition:
        raise DomainError(message, status, code)


def admin(user):
    return bool(user.is_superuser and user.is_active and not user.deleted_at)


def permission(user, code):
    if admin(user):
        return True
    if not user.group_id or not user.group.enabled:
        return False
    if user.group.action_permissions is not None:
        actions = action_permissions(user)
        menus = menu_permissions(user)
        if code == "view_project":
            return any(menu in menus for menu in PROJECT_MENUS + ["home", "projects"])
        if code == "view_reports":
            return "reports" in menus or "iterations" in menus
        if code == "create_project":
            return can_action(user, "projects", "create")
        if code == "export":
            return can_action(user, "reports", "export")
        if code in ["edit_items", "manage_items", "manage_members"]:
            return any(key.split(":")[0] in menus for key in actions)
    return code in user.group.permissions


def projects(user):
    qs = Project.objects.filter(deleted_at=None)
    if admin(user) or permission(user, "view_all_projects"):
        return qs
    if not permission(user, "view_project"):
        return qs.none()
    return qs.filter(member__user=user, member__deleted_at=None).distinct()


def role(user, project):
    if admin(user):
        return "admin"
    return (
        Member.objects.filter(project=project, user=user, deleted_at=None)
        .values_list("role", flat=True)
        .first()
    )


def access(user, project, write=False, manage=False, export=False, item=None):
    require(
        projects(user).filter(pk=project.pk).exists(),
        "已删除或无权访问",
        404,
        "NOT_FOUND",
    )
    if not write and not manage and not export:
        return
    r = role(user, project)
    require(r in ("admin", "member"), "没有操作权限", 403, "FORBIDDEN")
    if export:
        require(permission(user, "export"), "没有导出权限", 403, "FORBIDDEN")
        return
    require(project.status == "active", "项目已关闭，请先重新开启")
    if manage:
        require(
            r == "admin" and permission(user, "manage_members"),
            "需要项目管理权限",
            403,
            "FORBIDDEN",
        )
    else:
        require(permission(user, "edit_items"), "用户组不允许编辑", 403, "FORBIDDEN")
    if item and r == "admin":
        require(permission(user, "manage_items"), "用户组不允许管理工作项", 403, "FORBIDDEN")
