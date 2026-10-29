from django.db.models import Count
from django.utils import timezone
from rest_framework import serializers

from . import models as m
from .notification_text import notification_message
from .querysets import work_item_rows


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.User
        fields = [
            "id",
            "username",
            "display_name",
            "group",
            "position",
            "is_active",
            "is_superuser",
            "must_change_password",
            "version",
            "created_at",
            "updated_at",
        ]


MODELS = [
    m.Project,
    m.WorkflowTemplate,
    m.Member,
    m.Priority,
    m.Category,
    m.Iteration,
    m.WorkItem,
    m.RequirementDetail,
    m.TaskDetail,
    m.BugDetail,
    m.Document,
    m.Comment,
    m.Audit,
    m.Notification,
    m.Position,
    m.UserGroup,
]
SERIALIZERS = {
    model: type(
        model.__name__ + "Serializer",
        (serializers.ModelSerializer,),
        {"Meta": type("Meta", (), {"model": model, "fields": "__all__"})},
    )
    for model in MODELS
}


class NotificationSerializer(serializers.ModelSerializer):
    message = serializers.SerializerMethodField()

    class Meta:
        model = m.Notification
        fields = "__all__"

    def get_message(self, obj) -> str:
        return notification_message(obj.message, obj.event_type)


SERIALIZERS[m.Notification] = NotificationSerializer


class MemberSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(source="user.display_name", read_only=True)
    position_name = serializers.SerializerMethodField()

    class Meta:
        model = m.Member
        fields = "__all__"

    def get_position_name(self, obj) -> str:
        return obj.user.position.name if obj.user.position_id else ""


SERIALIZERS[m.Member] = MemberSerializer


class DocumentSerializer(serializers.ModelSerializer):
    web_url = serializers.SerializerMethodField()

    def get_web_url(self, obj) -> str:
        from .links import web_url

        return web_url(obj)

    download_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    author_name = serializers.CharField(source="author.display_name", read_only=True)

    class Meta:
        model = m.Document
        exclude = ["source_file", "preview_file"]

    def get_download_url(self, obj) -> str:
        return (
            f"/api/v1/documents/{obj.id}/download"
            if obj.document_type not in {"markdown", "folder"}
            else ""
        )

    def get_preview_url(self, obj) -> str:
        return (
            f"/api/v1/documents/{obj.id}/preview"
            if obj.document_type not in {"markdown", "folder"}
            else ""
        )


SERIALIZERS[m.Document] = DocumentSerializer


class IterationSerializer(serializers.ModelSerializer):
    web_url = serializers.SerializerMethodField()

    def get_web_url(self, obj) -> str:
        from .links import web_url

        return web_url(obj)

    class Meta:
        model = m.Iteration
        fields = "__all__"


SERIALIZERS[m.Iteration] = IterationSerializer


class UserGroupSerializer(serializers.ModelSerializer):
    action_permissions = serializers.ListField(
        child=serializers.CharField(), allow_null=True, required=False
    )
    effective_action_permissions = serializers.SerializerMethodField()

    def get_effective_action_permissions(self, obj) -> list[str]:
        from .policies import group_action_permissions

        return group_action_permissions(obj)

    class Meta:
        model = m.UserGroup
        fields = "__all__"


SERIALIZERS[m.UserGroup] = UserGroupSerializer


def serialize(obj, *, iteration_details=True):
    if isinstance(obj, m.User):
        return UserSerializer(obj).data
    if isinstance(obj, m.Attachment):
        return {
            "id": str(obj.id),
            "original_name": obj.original_name,
            "scope": "items" if obj.item_id else "documents",
            "size_bytes": obj.size_bytes,
            "uploaded_by": str(obj.uploaded_by_id),
            "uploaded_by_name": obj.uploaded_by.display_name,
            "version": obj.version,
            "created_at": obj.created_at.isoformat(),
        }
    data = dict(SERIALIZERS[type(obj)](obj).data)
    if isinstance(obj, m.WorkItem):
        from .links import web_url

        data["web_url"] = web_url(obj)
    if isinstance(obj, m.Project):
        data["owner_name"] = obj.owner.display_name
        data["overdue_count"] = (
            m.WorkItem.objects.filter(
                project=obj, deleted_at=None, due_date__lt=timezone.localdate()
            )
            .exclude(status_category__in=["completed", "cancelled"])
            .count()
        )
        data["member_count"] = m.Member.objects.filter(project=obj, deleted_at=None).count()
        data["counts"] = {
            kind: m.WorkItem.objects.filter(project=obj, type=kind, deleted_at=None).count()
            for kind in ["requirement", "task", "bug"]
        }
    if isinstance(obj, m.Iteration):
        items = m.WorkItem.objects.filter(iteration=obj, deleted_at=None)
        data["item_total"] = obj._item_total if hasattr(obj, "_item_total") else items.count()
        data["item_completed"] = (
            obj._item_completed
            if hasattr(obj, "_item_completed")
            else items.filter(status_category="completed").count()
        )
        data["owner_name"] = obj.owner.display_name
        if not iteration_details:
            return data
        data["items_by_state"] = list(items.values("type", "status").annotate(count=Count("id")))
        data["overdue_items"] = [
            serialize(item)
            for item in work_item_rows(
                items.filter(due_date__lt=timezone.localdate()).exclude(
                    status_category__in=["completed", "cancelled"]
                )
            )[:20]
        ]
        data["recent_changes"] = [
            serialize(event)
            for event in m.Audit.objects.filter(
                entity_id__in=[str(v) for v in items.values_list("id", flat=True)]
            ).order_by("-created_at")[:10]
        ]
    if isinstance(obj, m.UserGroup):
        data["user_count"] = m.User.objects.filter(group=obj, deleted_at=None).count()
    if isinstance(obj, m.WorkItem):
        optimized = getattr(obj, "_read_optimized", False)
        detail = (
            getattr(obj, obj.type + "detail")
            if optimized
            else {
                "requirement": m.RequirementDetail,
                "task": m.TaskDetail,
                "bug": m.BugDetail,
            }[obj.type].objects.get(item=obj)
        )
        data["details"] = SERIALIZERS[type(detail)](detail).data
        people = list(obj.handlers.all())
        people.sort(key=lambda person: (person.id != obj.assignee_id, str(person.id)))
        data["handlers"] = [str(person.id) for person in people]
        data["handler_names"] = [person.display_name for person in people]
        data["assignee_name"] = "、".join(data["handler_names"]) or (
            obj.assignee.display_name if obj.assignee else None
        )
        data["priority_name"] = obj.priority.name
        data["priority_color"] = obj.priority.color
        data["created_by_name"] = obj.created_by.display_name
        spec = obj.project.workflow.get(obj.type, {})
        data["status_color"] = next(
            (state["color"] for state in spec.get("states", []) if state["code"] == obj.status),
            "blue",
        )
        data["status_name"] = next(
            (state["name"] for state in spec.get("states", []) if state["code"] == obj.status),
            obj.status,
        )
        if obj.type == "requirement":
            tasks = m.WorkItem.objects.filter(taskdetail__requirement=obj, deleted_at=None)
            data["child_task_total"] = obj._child_task_total if optimized else tasks.count()
            data["child_task_completed"] = (
                obj._child_task_completed
                if optimized
                else tasks.filter(status_category="completed").count()
            )
        if obj.type in ["task", "bug"]:
            related = detail.requirement
            data["requirement_title"] = (
                ("关联已失效" if related.deleted_at else related.title) if related else None
            )

    if isinstance(obj, m.Comment):
        data["author_name"] = obj.author.display_name
    return data


# Order is maintained by the reorder service, never by configuration forms.
for model in [m.Position, m.Priority, m.Category]:
    SERIALIZERS[model].Meta.extra_kwargs = {"sort_order": {"read_only": True}}


class OperationLogSerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    actor_name = serializers.CharField(source="actor.display_name", read_only=True)
    actor_username = serializers.CharField(source="actor.username", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    action_label = serializers.SerializerMethodField()
    resource_label = serializers.SerializerMethodField()

    class Meta:
        model = m.OperationLog
        fields = [
            "id",
            "created_at",
            "actor",
            "actor_name",
            "actor_username",
            "project",
            "project_name",
            "action",
            "action_label",
            "resource_type",
            "resource_label",
            "resource_id",
        ]

    def get_action_label(self, obj) -> str:
        from .operation_logs import ACTIONS

        return ACTIONS.get(obj.action, "其他操作")

    def get_resource_label(self, obj) -> str:
        from .operation_logs import RESOURCES

        return RESOURCES.get(obj.resource_type, "记录")


SERIALIZERS[m.OperationLog] = OperationLogSerializer
