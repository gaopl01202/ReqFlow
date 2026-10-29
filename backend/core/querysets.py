"""Read-side eager loading; caller retains ownership of permission/data scopes."""

from django.db.models import Count, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce

from . import models as m


def iteration_rows(queryset):
    active = Q(workitem__deleted_at=None)
    return queryset.select_related("owner", "project").annotate(
        _item_total=Count("workitem", filter=active),
        _item_completed=Count("workitem", filter=active & Q(workitem__status_category="completed")),
    )


def work_item_rows(queryset):
    children = m.WorkItem.objects.filter(
        taskdetail__requirement_id=OuterRef("pk"), deleted_at=None
    ).order_by()

    def count(source):
        totals = source.values("taskdetail__requirement_id").annotate(total=Count("pk"))
        return Coalesce(Subquery(totals.values("total")[:1], output_field=IntegerField()), Value(0))

    return (
        queryset.select_related(
            "project",
            "priority",
            "created_by",
            "assignee",
            "requirementdetail",
            "taskdetail__requirement",
            "bugdetail__requirement",
        )
        .prefetch_related("handlers")
        .annotate(
            _read_optimized=Value(True),
            _child_task_total=count(children),
            _child_task_completed=count(children.filter(status_category="completed")),
        )
    )
