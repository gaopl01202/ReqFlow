"""Compact successful-operation journal, separate from detailed business audit."""

from . import models as m

ACTIONS = {
    "login": "登录",
    "logout": "退出登录",
    "change_password": "修改密码",
    "reset-password": "重置密码",
    "create": "新建",
    "update": "编辑",
    "delete": "删除",
    "add": "添加",
    "remove": "移除",
    "transition": "流转",
    "reactivate": "重新激活",
    "restore": "恢复",
    "upload": "上传",
    "download": "下载",
    "export": "导出",
    "comment": "保存评论",
    "handover": "移交",
    "assignment": "指派",
    "reorder": "调整顺序",
    "close": "关闭",
    "reopen": "重新开启",
    "start": "开始",
    "finish": "结束",
    "workflow": "配置工作流",
    "activate": "启用",
    "deactivate": "停用",
    "iteration_move": "调整迭代",
    "read": "标记已读",
    "mark-all-read": "全部已读",
}
RESOURCES = {
    "User": "用户",
    "Project": "项目",
    "requirement": "需求",
    "task": "任务",
    "bug": "缺陷",
    "Member": "项目成员",
    "Priority": "字典项",
    "Category": "分类",
    "Iteration": "迭代",
    "Document": "文档",
    "folder": "文件夹",
    "Comment": "评论",
    "Attachment": "附件",
    "Position": "职务",
    "UserGroup": "用户组",
    "WorkflowTemplate": "默认工作流",
    "Notification": "通知",
    "Report": "报表",
}


def record(user, obj, action):
    kind = type(obj).__name__
    if isinstance(obj, m.WorkItem):
        kind = obj.type
    elif isinstance(obj, m.Document) and obj.document_type == "folder":
        kind = "folder"
    project = obj if isinstance(obj, m.Project) else getattr(obj, "project", None)
    if isinstance(obj, m.Comment):
        project = obj.item.project
    return m.OperationLog.objects.create(
        actor=user, project=project, action=action, resource_type=kind, resource_id=str(obj.pk)
    )


def listing(request):
    from django.db.models import Q
    from rest_framework import serializers

    from .policies import require
    from .serializers import OperationLogSerializer

    class Filters(serializers.Serializer):
        q = serializers.CharField(required=False, allow_blank=True, max_length=200)
        action = serializers.ChoiceField(choices=list(ACTIONS), required=False, allow_blank=True)
        resource_type = serializers.ChoiceField(
            choices=list(RESOURCES), required=False, allow_blank=True
        )
        date_from = serializers.DateField(required=False)
        date_to = serializers.DateField(required=False)
        page = serializers.IntegerField(min_value=1, default=1)
        page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)

    filters = Filters(data=request.query_params)
    if not filters.is_valid():
        from .policies import DomainError

        raise DomainError("日志筛选条件无效", fields=filters.errors)
    values = filters.validated_data
    require(
        not (values.get("date_from") and values.get("date_to"))
        or values["date_from"] <= values["date_to"],
        "开始日期不能晚于结束日期",
    )
    rows = m.OperationLog.objects.select_related("actor", "project")
    if values.get("q"):
        query = values["q"]
        rows = rows.filter(
            Q(actor__display_name__icontains=query)
            | Q(actor__username__icontains=query)
            | Q(resource_id__icontains=query)
            | Q(project__name__icontains=query)
            | Q(project__code__icontains=query)
        )
    for key in ("action", "resource_type"):
        if values.get(key):
            rows = rows.filter(**{key: values[key]})
    for key, lookup in (
        ("date_from", "created_at__date__gte"),
        ("date_to", "created_at__date__lte"),
    ):
        if values.get(key):
            rows = rows.filter(**{lookup: values[key]})
    size, page = values["page_size"], values["page"]
    return {
        "items": OperationLogSerializer(rows[(page - 1) * size : page * size], many=True).data,
        "total": rows.count(),
        "page": page,
        "page_size": size,
        "actions": [{"value": key, "label": value} for key, value in ACTIONS.items()],
        "resource_types": [{"value": key, "label": value} for key, value in RESOURCES.items()],
    }
