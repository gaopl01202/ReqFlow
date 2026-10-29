import re

from drf_spectacular.openapi import AutoSchema
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers

from . import models as m
from .serializers import SERIALIZERS, UserSerializer


class WorkflowStateSerializer(serializers.Serializer):
    code = serializers.RegexField(r"^[a-z][a-z0-9_]{0,29}$")
    name = serializers.CharField(max_length=50)
    color = serializers.CharField()
    order = serializers.IntegerField(min_value=0)
    category = serializers.ChoiceField(
        choices=["pending", "completed", "cancelled"], required=False
    )
    initial = serializers.BooleanField(required=False)


WorkflowTransitionSerializer = type(
    "WorkflowTransitionSerializer",
    (serializers.Serializer,),
    {
        "from": serializers.CharField(),
        "to": serializers.CharField(),
        "enabled": serializers.BooleanField(),
    },
)


class WorkflowSpecSerializer(serializers.Serializer):
    states = WorkflowStateSerializer(many=True, min_length=2, max_length=100)
    transitions = WorkflowTransitionSerializer(many=True, max_length=10000)


class WorkflowDefinitionSerializer(serializers.Serializer):
    requirement = WorkflowSpecSerializer()
    task = WorkflowSpecSerializer()
    bug = WorkflowSpecSerializer()


class CommandSerializer(serializers.Serializer):
    upload_tokens = serializers.ListField(
        child=serializers.RegexField(r"^reqflow-upload:[0-9a-f-]{36}$"),
        required=False,
        max_length=20,
    )
    version = serializers.IntegerField(required=False, min_value=1)
    type = serializers.ChoiceField(choices=["requirement", "task", "bug"], required=False)
    title = serializers.CharField(max_length=200, required=False)
    name = serializers.CharField(max_length=100, required=False)
    username = serializers.CharField(max_length=150, required=False)
    display_name = serializers.CharField(max_length=20, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    body = serializers.CharField(required=False, allow_blank=True)
    document_type = serializers.ChoiceField(choices=["folder"], required=False)
    parent = serializers.UUIDField(required=False, allow_null=True)
    password = serializers.CharField(required=False, write_only=True)
    old_password = serializers.CharField(required=False, write_only=True)
    code = serializers.CharField(max_length=30, required=False)
    target_status = serializers.CharField(required=False)
    reactivate = serializers.BooleanField(required=False, default=False)
    reason = serializers.CharField(required=False, allow_blank=True)
    confirm = serializers.BooleanField(required=False)
    confirm_overlap = serializers.BooleanField(required=False)
    enabled = serializers.BooleanField(required=False)
    sort_order = serializers.IntegerField(required=False, min_value=0)
    color = serializers.CharField(required=False)
    action_permissions = serializers.ListField(child=serializers.CharField(), required=False)
    menu_permissions = serializers.ListField(child=serializers.CharField(), required=False)
    permissions = serializers.ListField(child=serializers.CharField(), required=False)
    role = serializers.ChoiceField(choices=["admin", "member", "readonly"], required=False)
    disposition = serializers.ChoiceField(choices=["keep", "move"], required=False)
    workflow = WorkflowDefinitionSerializer(required=False)
    unfinished_items = serializers.DictField(required=False)
    items = serializers.ListField(child=serializers.DictField(), required=False)
    users = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=100)
    changes = serializers.DictField(required=False)
    handlers = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=100)
    mentions = serializers.ListField(child=serializers.UUIDField(), required=False)
    goal = serializers.CharField(required=False, allow_blank=True)
    kind = serializers.ChoiceField(
        choices=["environment", "severity", "priority", "source"], required=False
    )
    source = serializers.CharField(max_length=30, required=False, allow_blank=True)
    proposer = serializers.CharField(required=False, allow_blank=True)
    acceptance_criteria = serializers.CharField(required=False, allow_blank=True)
    steps_to_reproduce = serializers.CharField(required=False, allow_blank=True)
    actual_result = serializers.CharField(required=False, allow_blank=True)
    expected_result = serializers.CharField(required=False, allow_blank=True)
    environment = serializers.CharField(required=False, allow_blank=True)
    severity = serializers.CharField(max_length=20, required=False, allow_blank=True)


for key in [
    "owner",
    "user",
    "priority",
    "category",
    "iteration",
    "assignee",
    "requirement",
    "task",
    "position",
    "group",
    "target_iteration",
]:
    CommandSerializer._declared_fields[key] = serializers.UUIDField(required=False, allow_null=True)
for key in [
    "planned_start_date",
    "planned_end_date",
    "start_date",
    "end_date",
    "due_date",
    "expected_finish_date",
]:
    CommandSerializer._declared_fields[key] = serializers.DateField(required=False, allow_null=True)


class OrderedConfigCommandSerializer(CommandSerializer):
    sort_order = None


class ReorderSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(
        choices=["environment", "severity", "priority", "source"], required=False
    )
    item_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    target_id = serializers.UUIDField()
    target_version = serializers.IntegerField(min_value=1)
    placement = serializers.ChoiceField(choices=["before", "after"])


class ErrorSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    fields = serializers.DictField()
    request_id = serializers.UUIDField()


class ObjectSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    version = serializers.IntegerField(required=False)
    items = serializers.ListField(child=serializers.DictField(), required=False)
    ancestors = serializers.ListField(child=serializers.DictField(), required=False)
    total = serializers.IntegerField(required=False)
    page = serializers.IntegerField(required=False)
    page_size = serializers.IntegerField(required=False)


class _ContractBase(AutoSchema):
    def get_override_parameters(self):
        parameters = super().get_override_parameters()
        if self.method == "GET" and self.path.endswith("/operation-logs"):
            from .operation_logs import ACTIONS, RESOURCES

            for key, kind, description, choices in [
                ("q", OpenApiTypes.STR, "操作人姓名/账号、对象ID、项目名称/编码", None),
                ("action", OpenApiTypes.STR, "操作类型", list(ACTIONS)),
                ("resource_type", OpenApiTypes.STR, "对象类型", list(RESOURCES)),
                ("date_from", OpenApiTypes.DATE, "开始日期（含）", None),
                ("date_to", OpenApiTypes.DATE, "结束日期（含）", None),
                ("page", OpenApiTypes.INT, "页码，最小1", None),
                ("page_size", OpenApiTypes.INT, "每页数量，1至100，默认20", None),
            ]:
                parameters.append(
                    OpenApiParameter(
                        key, kind, OpenApiParameter.QUERY, description=description, enum=choices
                    )
                )
        if self.method == "GET" and self.path.endswith("/dictionaries"):
            parameters.append(
                OpenApiParameter(
                    "kind",
                    OpenApiTypes.STR,
                    OpenApiParameter.QUERY,
                    enum=["environment", "severity", "priority", "source"],
                    description="字典类型，默认priority",
                )
            )
        if self.method == "GET" and self.path.endswith("/documents"):
            parameters.append(
                OpenApiParameter(
                    "parent",
                    OpenApiTypes.UUID,
                    OpenApiParameter.QUERY,
                    description="当前文件夹，省略为根目录",
                )
            )
        if self.method == "GET" and self.path.endswith("/work-items"):
            parameters.append(
                OpenApiParameter(
                    "category",
                    OpenApiTypes.STR,
                    OpenApiParameter.QUERY,
                    description="分类UUID；none为未分类（默认分类），省略为全部",
                )
            )
        if self.method == "GET" and self.path.endswith("/reports/export"):
            parameters.append(
                OpenApiParameter(
                    "table",
                    OpenApiTypes.STR,
                    OpenApiParameter.QUERY,
                    enum=["states", "members", "bugs"],
                    description="导出当前筛选下的完整统计表；省略则兼容导出工作项明细",
                )
            )
        if self.method == "GET" and self.path.endswith("/me/todos"):
            parameters.append(
                OpenApiParameter(
                    "todo_scope",
                    OpenApiTypes.STR,
                    OpenApiParameter.QUERY,
                    enum=["all", "today", "overdue"],
                    description="本人待办范围，默认all",
                )
            )
        return parameters

    def get_operation_id(self):
        return self.method.lower() + "_" + re.sub(r"[^a-zA-Z0-9]+", "_", self.path).strip("_")

    def get_request_serializer(self):
        return CommandSerializer

    def get_response_serializers(self):
        return {
            200: ObjectSerializer,
            201: ObjectSerializer,
            401: ErrorSerializer,
            403: ErrorSerializer,
            404: ErrorSerializer,
            409: ErrorSerializer,
            422: ErrorSerializer,
        }


# Response schemas share the model serializers used by the API, including public computed fields.


class SessionActivitySerializer(serializers.Serializer):
    session_expires_at = serializers.FloatField(allow_null=True)
    session_remaining_seconds = serializers.FloatField(allow_null=True)


class LinkTargetSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    project = serializers.UUIDField()
    project_code = serializers.CharField()
    type = serializers.ChoiceField(choices=["requirement", "task", "bug", "document", "iteration"])
    web_url = serializers.CharField()


class CurrentUserSerializer(UserSerializer):
    session_expires_at = serializers.FloatField(allow_null=True)
    session_remaining_seconds = serializers.FloatField(allow_null=True)
    session_idle_timeout_seconds = serializers.IntegerField()
    action_permissions = serializers.ListField(child=serializers.CharField())
    menu_permissions = serializers.ListField(child=serializers.CharField())
    permissions = serializers.ListField(child=serializers.CharField())
    attachment_max_bytes = serializers.IntegerField()
    attachment_extensions = serializers.ListField(child=serializers.CharField())
    document_max_bytes = serializers.IntegerField()
    document_extensions = serializers.ListField(child=serializers.CharField())

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + [
            "permissions",
            "menu_permissions",
            "action_permissions",
            "session_expires_at",
            "session_remaining_seconds",
            "session_idle_timeout_seconds",
            "attachment_max_bytes",
            "attachment_extensions",
            "document_max_bytes",
            "document_extensions",
        ]


class UserCommandResultSerializer(UserSerializer):
    temporary_password = serializers.CharField(required=False)

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ["temporary_password"]


class WorkItemResponseSerializer(SERIALIZERS[m.WorkItem]):
    web_url = serializers.CharField(read_only=True)
    status_color = serializers.CharField(read_only=True)
    handler_names = serializers.ListField(child=serializers.CharField())
    details = serializers.DictField()
    priority_name = serializers.CharField()
    assignee_name = serializers.CharField(allow_null=True)
    created_by_name = serializers.CharField()
    status_name = serializers.CharField()
    child_task_total = serializers.IntegerField(required=False)
    child_task_completed = serializers.IntegerField(required=False)
    requirement_title = serializers.CharField(required=False, allow_null=True)

    class Meta(SERIALIZERS[m.WorkItem].Meta):
        fields = "__all__"


class RecycleItemResponseSerializer(WorkItemResponseSerializer):
    project_name = serializers.CharField(required=False)
    deleted_by_name = serializers.CharField(required=False)
    can_restore = serializers.BooleanField(required=False)


class CommentResponseSerializer(SERIALIZERS[m.Comment]):
    author_name = serializers.CharField()

    class Meta(SERIALIZERS[m.Comment].Meta):
        fields = "__all__"


class AttachmentResponseSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=["items", "documents"])
    id = serializers.UUIDField()
    original_name = serializers.CharField()
    size_bytes = serializers.IntegerField()
    uploaded_by = serializers.UUIDField()
    uploaded_by_name = serializers.CharField()
    version = serializers.IntegerField()
    created_at = serializers.DateTimeField()


class UploadSerializer(serializers.Serializer):
    parent = serializers.UUIDField(required=False, allow_null=True)
    file = serializers.FileField()


class ReportSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    completed = serializers.IntegerField()
    unfinished = serializers.IntegerField()
    completion_rate = serializers.FloatField(allow_null=True)
    states = serializers.ListField(child=serializers.DictField())
    members = serializers.ListField(child=serializers.DictField())
    bugs = serializers.ListField(child=serializers.DictField())
    severities = serializers.ListField(child=serializers.DictField())


class ProjectContextSerializer(serializers.Serializer):
    project = SERIALIZERS[m.Project]()
    members = serializers.ListField(child=serializers.DictField())
    iterations = serializers.ListField(child=serializers.DictField())
    categories = serializers.ListField(child=serializers.DictField())
    workflow = serializers.DictField()
    dictionaries = serializers.ListField(child=serializers.DictField())


class WorkspaceContextSerializer(serializers.Serializer):
    positions = serializers.ListField(child=serializers.DictField())
    groups = serializers.ListField(child=serializers.DictField())


class DashboardSerializer(serializers.Serializer):
    unfinished = serializers.IntegerField()
    due_today = serializers.IntegerField()
    overdue = serializers.IntegerField()
    projects = serializers.IntegerField()
    activity = SERIALIZERS[m.Audit](many=True)
    types = serializers.ListField(child=serializers.DictField())
    project_progress = serializers.ListField(child=serializers.DictField())


class BoardSerializer(serializers.Serializer):
    columns = serializers.ListField(child=serializers.DictField())


class WorkflowSerializer(serializers.Serializer):
    workflow = WorkflowDefinitionSerializer()
    version = serializers.IntegerField()


class BulkResultSerializer(serializers.Serializer):
    succeeded = serializers.ListField(child=serializers.UUIDField())
    failed = serializers.ListField(child=serializers.DictField())
    success_count = serializers.IntegerField()
    failure_count = serializers.IntegerField()


class TokenSerializer(serializers.Serializer):
    csrf_token = serializers.CharField()


class HealthSerializer(serializers.Serializer):
    status = serializers.CharField()


PAGES = {}


def page_serializer(serializer):
    name = serializer.__name__.removesuffix("Serializer") + "PageSerializer"
    if name not in PAGES:
        PAGES[name] = type(
            name,
            (serializers.Serializer,),
            {
                "items": serializer(many=True),
                "total": serializers.IntegerField(),
                "page": serializers.IntegerField(),
                "page_size": serializers.IntegerField(),
                **(
                    {"ancestors": serializers.ListField(child=serializers.DictField())}
                    if serializer is SERIALIZERS[m.Document]
                    else {}
                ),
            },
        )
    return PAGES[name]


class RecordUploadSerializer(serializers.Serializer):
    payload = serializers.CharField(
        help_text="JSON 编码的 Command，含按 files 顺序排列的 upload_tokens；图片使用 reqflow-upload:UUID 占位"
    )
    files = serializers.ListField(child=serializers.FileField(), max_length=20, required=False)


class OperationLogPageSerializer(serializers.Serializer):
    items = SERIALIZERS[m.OperationLog](many=True)
    total = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    actions = serializers.ListField(child=serializers.DictField(child=serializers.CharField()))
    resource_types = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField())
    )


class ContractSchema(_ContractBase):
    def _get_request_body(self, direction="request"):
        body = super()._get_request_body(direction)
        if self.path.endswith("/documents/import") and body:
            body["content"] = {"multipart/form-data": next(iter(body["content"].values()))}
            return body
        parts = self.path.removeprefix("/api/v1/").split("/")
        record = (parts[0] == "projects" and parts[-1] in ["work-items", "documents"]) or (
            parts[0] in ["work-items", "documents", "comments"]
            and len(parts) == 2
            and parts[1] != "bulk-update"
        )
        record = record or (
            parts[0] == "work-items" and len(parts) == 3 and parts[2] in ["comments", "transition"]
        )
        if body and record and self.method in ["POST", "PATCH"]:
            component = self.resolve_serializer(RecordUploadSerializer(), direction)
            body["content"]["multipart/form-data"] = {"schema": component.ref}
        return body

    def get_request_serializer(self):
        if self.path.endswith("/reorder"):
            return ReorderSerializer
        if (
            self.path.removeprefix("/api/v1/").split("/")[0] in ["positions", "priorities"]
            or "/categories" in self.path
            or "/dictionaries" in self.path
        ):
            return OrderedConfigCommandSerializer
        return (
            UploadSerializer
            if self.path.endswith(("/attachments", "/documents/import")) and self.method == "POST"
            else CommandSerializer
        )

    def get_response_serializers(self):
        path = self.path.removeprefix("/api/v1/")
        pieces = path.split("/")
        response = ObjectSerializer
        if path.startswith("links/"):
            return {
                200: LinkTargetSerializer,
                401: ErrorSerializer,
                403: ErrorSerializer,
                404: ErrorSerializer,
            }
        if path.endswith("/metadata"):
            return {
                200: AttachmentResponseSerializer,
                401: ErrorSerializer,
                403: ErrorSerializer,
                404: ErrorSerializer,
            }
        if path.endswith(("/preview", "/download")):
            return {
                (
                    200,
                    "application/pdf" if path.endswith("/preview") else "application/octet-stream",
                ): OpenApiTypes.BINARY,
                **(
                    {
                        (200, "text/plain"): OpenApiTypes.BINARY,
                        (200, "text/csv"): OpenApiTypes.BINARY,
                        (200, "application/octet-stream"): OpenApiTypes.BINARY,
                    }
                    if path.endswith("/preview")
                    else {}
                ),
                403: ErrorSerializer,
                404: ErrorSerializer,
            }
        if self.method == "GET" and (
            path.endswith("/reports/export") or path.startswith("attachments/")
        ):
            return {
                (
                    200,
                    "text/csv" if path.endswith("/reports/export") else "application/octet-stream",
                ): OpenApiTypes.BINARY,
                403: ErrorSerializer,
                404: ErrorSerializer,
            }
        if path.endswith("/reorder"):
            response = page_serializer(
                SERIALIZERS[
                    m.Category
                    if "categories" in pieces
                    else m.Position
                    if pieces[0] == "positions"
                    else m.Priority
                ]
            )
        elif path == "auth/me":
            response = CurrentUserSerializer
        elif path == "auth/activity":
            response = SessionActivitySerializer
        elif path == "auth/csrf":
            response = TokenSerializer
        elif path == "health":
            response = HealthSerializer
        elif path.startswith("auth/"):
            response = UserSerializer
        elif path.endswith("/context"):
            response = (
                ProjectContextSerializer if pieces[0] == "projects" else WorkspaceContextSerializer
            )
        elif path == "me/dashboard":
            response = DashboardSerializer
        elif "reports" in pieces:
            response = ReportSerializer
        elif path.endswith("/board"):
            response = BoardSerializer
        elif path == "workflow-template":
            response = WorkflowSerializer
        elif path.endswith("/workflow"):
            response = WorkflowSerializer if self.method == "GET" else SERIALIZERS[m.Project]
        elif (
            path == "work-items/bulk-update"
            or path.endswith("/members/bulk")
            or path.endswith("/members/bulk-delete")
        ):
            response = BulkResultSerializer
        elif path == "operation-logs":
            response = OperationLogPageSerializer
        elif path == "recycle-bin":
            response = page_serializer(RecycleItemResponseSerializer)
        else:
            registry = {
                "users": UserCommandResultSerializer,
                "projects": SERIALIZERS[m.Project],
                "members": SERIALIZERS[m.Member],
                "work-items": WorkItemResponseSerializer,
                "recycle-bin": RecycleItemResponseSerializer,
                "todos": WorkItemResponseSerializer,
                "iterations": SERIALIZERS[m.Iteration],
                "documents": SERIALIZERS[m.Document],
                "comments": CommentResponseSerializer,
                "attachments": AttachmentResponseSerializer,
                "history": SERIALIZERS[m.Audit],
                "notifications": SERIALIZERS[m.Notification],
                "categories": SERIALIZERS[m.Category],
                "priorities": SERIALIZERS[m.Priority],
                "dictionaries": SERIALIZERS[m.Priority],
                "positions": SERIALIZERS[m.Position],
                "user-groups": SERIALIZERS[m.UserGroup],
            }
            resource = next((p for p in reversed(pieces) if p in registry), None)
            if resource:
                response = registry[resource]
                if self.method == "GET" and pieces[-1] == resource:
                    response = page_serializer(response)
        success = (
            204
            if self.method == "DELETE" or path == "auth/logout"
            else 201
            if self.method == "POST"
            and pieces[-1]
            in [
                "import",
                "projects",
                "users",
                "work-items",
                "documents",
                "iterations",
                "comments",
                "attachments",
                "positions",
                "user-groups",
                "priorities",
                "members",
                "categories",
            ]
            else 200
        )
        return {
            success: None if success == 204 else response,
            401: ErrorSerializer,
            403: ErrorSerializer,
            404: ErrorSerializer,
            409: ErrorSerializer,
            422: ErrorSerializer,
        }
