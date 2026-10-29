import secrets
import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


def dictionary_code():
    return secrets.token_hex(8)


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    version = models.PositiveIntegerField(default=1)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True


class UserGroup(Record):
    name = models.CharField(max_length=100, unique=True)
    enabled = models.BooleanField(default=True)
    builtin = models.BooleanField(default=False)
    permissions = models.JSONField(default=list, blank=True)
    menu_permissions = models.JSONField(null=True, blank=True, default=None)
    action_permissions = models.JSONField(null=True, blank=True, default=None)


class Position(Record):
    name = models.CharField(max_length=20, unique=True)
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    display_name = models.CharField(max_length=20)
    group = models.ForeignKey(UserGroup, null=True, on_delete=models.PROTECT)
    position = models.ForeignKey(Position, null=True, on_delete=models.PROTECT)
    must_change_password = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    version = models.PositiveIntegerField(default=1)


class Project(Record):
    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, max_length=1000)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, default="active")
    planned_start_date = models.DateField(null=True)
    planned_end_date = models.DateField(null=True)
    workflow = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(planned_end_date__gte=models.F("planned_start_date"))
                | models.Q(planned_start_date=None)
                | models.Q(planned_end_date=None),
                name="project_dates",
            )
        ]


class WorkflowTemplate(Record):
    key = models.CharField(max_length=20, unique=True, default="default")
    workflow = models.JSONField(default=dict)


class Member(Record):
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    role = models.CharField(max_length=20)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["project", "user"], name="unique_member")]


class Priority(Record):
    # Shared storage for default templates and independently copied project dictionaries.
    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.PROTECT)
    kind = models.CharField(max_length=20, default="priority")
    code = models.CharField(max_length=30, default=dictionary_code)
    name = models.CharField(max_length=50)
    color = models.CharField(max_length=20, default="blue")
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "kind", "name"],
                condition=models.Q(deleted_at=None, project__isnull=False),
                name="project_dictionary_name",
            ),
            models.UniqueConstraint(
                fields=["kind", "name"],
                condition=models.Q(deleted_at=None, project=None),
                name="template_dictionary_name",
            ),
            models.UniqueConstraint(
                fields=["project", "kind", "code"],
                condition=models.Q(deleted_at=None, project__isnull=False),
                name="project_dictionary_code",
            ),
            models.UniqueConstraint(
                fields=["kind", "code"],
                condition=models.Q(deleted_at=None, project=None),
                name="template_dictionary_code",
            ),
        ]


class Category(Record):
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    name = models.CharField(max_length=50)
    sort_order = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["project", "name"], name="unique_category")]


class Iteration(Record):
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    goal = models.TextField(blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, default="planned")

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")),
                name="iteration_dates",
            )
        ]


class Counter(models.Model):
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    item_type = models.CharField(max_length=20)
    value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "item_type"], name="unique_counter")
        ]


class WorkItem(Record):
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    type = models.CharField(max_length=20)
    number = models.CharField(max_length=80, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=30)
    status_category = models.CharField(max_length=12, default="pending")
    priority = models.ForeignKey(Priority, on_delete=models.PROTECT)
    category = models.ForeignKey(Category, null=True, on_delete=models.PROTECT)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="assigned_items",
    )
    handlers = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="handled_items", blank=True
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_items"
    )
    iteration = models.ForeignKey(Iteration, null=True, on_delete=models.PROTECT)
    planned_start_date = models.DateField(null=True)
    due_date = models.DateField(null=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [
            models.Index(fields=["project", "deleted_at", "type", "created_at"]),
            models.Index(fields=["assignee", "deleted_at", "status", "due_date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(due_date__gte=models.F("planned_start_date"))
                | models.Q(planned_start_date=None)
                | models.Q(due_date=None),
                name="item_dates",
            )
        ]


class RequirementDetail(models.Model):
    item = models.OneToOneField(WorkItem, primary_key=True, on_delete=models.PROTECT)
    source = models.CharField(max_length=30, default="internal", blank=True)
    proposer = models.CharField(max_length=100, blank=True)
    acceptance_criteria = models.TextField(blank=True)
    expected_finish_date = models.DateField(null=True)


class TaskDetail(models.Model):
    item = models.OneToOneField(WorkItem, primary_key=True, on_delete=models.PROTECT)
    requirement = models.ForeignKey(
        WorkItem, null=True, on_delete=models.PROTECT, related_name="child_tasks"
    )


class BugDetail(models.Model):
    item = models.OneToOneField(WorkItem, primary_key=True, on_delete=models.PROTECT)
    steps_to_reproduce = models.TextField(blank=True)
    actual_result = models.TextField(blank=True)
    expected_result = models.TextField(blank=True)
    environment = models.TextField(blank=True)
    severity = models.CharField(max_length=20, default="normal", blank=True)
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reported_bugs"
    )
    requirement = models.ForeignKey(
        WorkItem, null=True, on_delete=models.PROTECT, related_name="linked_bugs"
    )
    task = models.ForeignKey(
        WorkItem, null=True, on_delete=models.PROTECT, related_name="task_bugs"
    )
    submitted_at = models.DateTimeField(null=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="submitted_bugs",
    )
    verified_at = models.DateTimeField(null=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="verified_bugs",
    )


class Document(Record):
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    document_type = models.CharField(max_length=12, default="markdown")
    original_name = models.CharField(max_length=255, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    source_file = models.FileField(upload_to="documents/originals/%Y/%m", blank=True)
    preview_file = models.FileField(upload_to="documents/previews/%Y/%m", blank=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="documents"
    )
    last_editor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="edited_documents",
    )


class Comment(Record):
    item = models.ForeignKey(WorkItem, on_delete=models.PROTECT)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    body = models.TextField()
    workflow_status = models.CharField(max_length=30, blank=True)
    workflow_status_name = models.CharField(max_length=100, blank=True)
    mentions = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="mentions")


class Attachment(Record):
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    item = models.ForeignKey(WorkItem, null=True, on_delete=models.PROTECT)
    document = models.ForeignKey(Document, null=True, on_delete=models.PROTECT)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    file = models.FileField(upload_to="%Y/%m")
    original_name = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField()
    is_inline_image = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(item__isnull=False, document__isnull=True)
                    | models.Q(item__isnull=True, document__isnull=False)
                ),
                name="attachment_one_parent",
            )
        ]


class OperationLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    project = models.ForeignKey(Project, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=32)
    resource_type = models.CharField(max_length=32)
    resource_id = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class Audit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    entity_type = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=50)
    action = models.CharField(max_length=50)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class Notification(Record):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    project = models.ForeignKey(Project, on_delete=models.PROTECT)
    item = models.ForeignKey(WorkItem, on_delete=models.PROTECT)
    event_type = models.CharField(max_length=30)
    message = models.CharField(max_length=300)
    read_at = models.DateTimeField(null=True)
    dedupe_key = models.CharField(max_length=200)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["recipient", "dedupe_key"], name="notification_dedupe")
        ]


class NotificationEvent(Record):
    item = models.ForeignKey(WorkItem, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    event_type = models.CharField(max_length=30)
    recipients = models.JSONField(default=list)
    dedupe_key = models.CharField(max_length=200, unique=True)
    delivered_at = models.DateTimeField(null=True)
    attempts = models.PositiveIntegerField(default=0)
