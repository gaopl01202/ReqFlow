"""Development-only scenario orchestration; business writes use existing services."""

import json
import random
import re
import secrets
import uuid
from collections import deque
from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.utils import timezone

from . import models as m
from . import services as s
from .demo_files import MODULES, document_payload, preview_image
from .document_files import import_document
from .policies import DEFAULT_PERMISSIONS, require
from .workflow import normalized

PROJECT_NAMES = [
    "客户服务协同平台",
    "供应链采购管理",
    "企业数据分析中台",
    "移动办公门户",
    "财务报销与预算",
    "仓储物流调度",
    "人力资源服务",
    "会员营销增长",
    "设备巡检运维",
    "合同与法务管理",
    "订单履约中心",
]
FEATURES = [
    "组织架构同步",
    "角色权限分配",
    "批量导入",
    "审批流程编排",
    "历史记录查询",
    "指标看板",
    "消息订阅",
    "移动端适配",
    "第三方接口对接",
    "数据导出",
    "异常重试",
    "字段校验",
    "操作审计",
    "自定义筛选",
    "附件管理",
    "性能优化",
    "单点登录",
    "数据权限隔离",
    "批量操作",
    "统计口径核对",
]
TASKS = [
    "接口实现",
    "交互优化",
    "联调与回归",
    "数据库查询优化",
    "权限校验",
    "测试用例补充",
    "灰度发布检查",
    "错误处理完善",
]
BUGS = [
    "筛选后分页未重置",
    "弱网下提交重复",
    "导出字段顺序异常",
    "切换组织后数据未刷新",
    "长标题显示截断",
    "边界日期校验错误",
    "无权限时提示不明确",
    "移动端按钮被遮挡",
    "批量操作部分失败未提示",
    "附件名称编码异常",
    "统计结果与明细不一致",
    "并发修改覆盖旧值",
]
COMMENTS = [
    "已和业务同事确认处理范围，本轮先覆盖高频场景。",
    "接口联调通过，补充了空数据和权限不足场景。",
    "回归发现边界问题，已补充截图，请按验收清单再核对。",
    "测试环境验证通过，下一步安排灰度观察。",
    "本次调整保持历史数据兼容，建议重点关注批量操作。",
]


def route_to(spec, start, target):
    queue = deque([(start, [])])
    seen = {start}
    while queue:
        current, path = queue.popleft()
        if current == target:
            return path
        for edge in spec["transitions"]:
            if edge["enabled"] and edge["from"] == current and edge["to"] not in seen:
                seen.add(edge["to"])
                queue.append((edge["to"], [*path, edge["to"]]))
    raise ValueError(f"不可达状态：{start} -> {target}")


def write_private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        temporary.chmod(0o600)
        json.dump(data, file, ensure_ascii=False, indent=2)
    temporary.replace(path)


class DemoScenario:
    def __init__(self, actor, batch, counts, output, emit=print):
        self.actor, self.batch, self.counts, self.output, self.emit = (
            actor,
            batch,
            counts,
            output,
            emit,
        )
        self.anchor = timezone.now().replace(microsecond=0)
        self.clock = self.anchor
        self.manifest_path = output / "manifest.json"
        self.manifest = (
            json.loads(self.manifest_path.read_text())
            if self.manifest_path.exists()
            else {
                "batch": batch,
                "counts": counts,
                "anchor": self.anchor.isoformat(),
                "users": [],
                "projects": [],
            }
        )
        require(self.manifest["counts"] == counts, "已有批次的数量参数不同，请使用新批次")
        self.anchor = datetime.fromisoformat(self.manifest["anchor"])
        self.credentials_path = output / "credentials.json"
        self.credentials = (
            json.loads(self.credentials_path.read_text()) if self.credentials_path.exists() else []
        )

    def checkpoint(self):
        write_private(self.manifest_path, self.manifest)

    def at(self, value):
        self.clock = min(value, self.anchor)

    def rng(self, *parts):
        return random.Random(": ".join(map(str, (self.batch, *parts))))

    def run(self):
        self.checkpoint()
        with patch("django.utils.timezone.now", side_effect=lambda: self.clock):
            self.users = self.create_users()
            for index in range(self.counts["projects"]):
                self.create_project(index)
        report = self.verify()
        write_private(self.output / "summary.json", report)
        return report

    def create_users(self):
        self.at(self.anchor - timedelta(days=580))
        group_name = f"模拟团队-{self.batch}"
        group = m.UserGroup.objects.filter(name=group_name).first() or s.config_write(
            self.actor, m.UserGroup, {"name": group_name, "permissions": DEFAULT_PERMISSIONS}
        )
        positions = []
        for name in ["产品经理", "前端开发", "后端开发", "测试工程师", "项目经理", "运维工程师"]:
            positions.append(
                m.Position.objects.filter(name=name, deleted_at=None, enabled=True).first()
                or s.config_write(self.actor, m.Position, {"name": name})
            )
        users = []
        used = set()
        for i in range(self.counts["users"]):
            rng = self.rng("user", i)
            name = rng.choice(list("王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗")) + rng.choice(
                [
                    "思远",
                    "雨桐",
                    "子涵",
                    "嘉宁",
                    "明轩",
                    "欣然",
                    "俊杰",
                    "若溪",
                    "一诺",
                    "晨曦",
                    "文博",
                    "宇航",
                    "佳怡",
                    "梓萱",
                    "浩然",
                    "晓彤",
                    "清扬",
                    "知夏",
                    "安然",
                    "致远",
                ]
            )
            while name in used:
                name += rng.choice("宁安悦")
            used.add(name)
            username = f"{self.batch}.u{i + 1:02}"
            user = m.User.objects.filter(username=username).first()
            if user:
                require(str(user.id) in self.manifest["users"], f"账号冲突：{username}")
            else:
                with transaction.atomic():
                    user, temporary = s.user_write(
                        self.actor,
                        {
                            "username": username,
                            "display_name": name,
                            "group": str(group.id),
                            "position": str(positions[i % len(positions)].id),
                        },
                    )
                    password = secrets.token_urlsafe(18)
                    user = s.change_password(
                        user, {"old_password": temporary, "password": password}
                    )
                    self.credentials.append(
                        {"username": username, "name": name, "password": password}
                    )
                    write_private(self.credentials_path, self.credentials)
                    self.manifest["users"].append(str(user.id))
                    self.checkpoint()
            users.append(user)
        return users

    def create_project(self, index):
        rng = self.rng("project", index)
        code = f"{self.batch.upper()}-{index + 1:02}"
        entry = next((row for row in self.manifest["projects"] if row["code"] == code), None)
        if entry and entry.get("complete"):
            self.emit(f"{code} 已完成，跳过")
            return
        self.at(self.anchor - timedelta(days=510 - index * 3))
        owner = self.users[index % len(self.users)]
        project = m.Project.objects.filter(code=code).first()
        if project:
            require(entry and entry["id"] == str(project.id), f"项目编码冲突：{code}")
        else:
            project = s.create_project(
                self.actor,
                {
                    "code": code,
                    "name": PROJECT_NAMES[index % len(PROJECT_NAMES)] + "（模拟）",
                    "description": f"模拟团队长期协作场景，包含需求评审、开发联调、缺陷回归及版本发布。数据批次：{self.batch}",
                    "owner": str(owner.id),
                    "planned_start_date": self.clock.date(),
                    "planned_end_date": (self.anchor + timedelta(days=90)).date(),
                },
            )
            entry = {"id": str(project.id), "code": code, "complete": False}
            self.manifest["projects"].append(entry)
            self.checkpoint()
        team = [owner, *[u for u in rng.sample(self.users, 15) if u.id != owner.id]]
        for i, user in enumerate(team):
            if not m.Member.objects.filter(project=project, user=user, deleted_at=None).exists():
                s.member_write(
                    self.actor,
                    project.id,
                    {"user": str(user.id), "role": "admin" if i == 1 else "member"},
                )
        categories = []
        for name in MODULES:
            categories.append(
                m.Category.objects.filter(project=project, name=name).first()
                or s.config_write(self.actor, m.Category, {"name": name}, pid=project.id)
            )
        iterations = []
        first_day = self.anchor.date() - timedelta(days=364)
        for i in range(12):
            start = first_day + timedelta(days=35 * i)
            name = f"迭代 {i + 1:02} · {start:%Y.%m}"
            iterations.append(
                m.Iteration.objects.filter(project=project, name=name).first()
                or s.iteration_write(
                    self.actor,
                    project.id,
                    {
                        "name": name,
                        "goal": f"完成{FEATURES[(index + i) % len(FEATURES)]}和重点缺陷回归，交付可验证的增量版本。",
                        "owner": str(team[i % len(team)].id),
                        "start_date": start,
                        "end_date": start + timedelta(days=34),
                    },
                )
            )
        dictionaries = {
            kind: list(
                m.Priority.objects.filter(
                    project=project, kind=kind, enabled=True, deleted_at=None
                ).order_by("sort_order")
            )
            for kind in s.DICTIONARY_KINDS
        }
        require(all(dictionaries.values()), "默认字典需包含四类启用项")
        for kind in ["requirement", "task", "bug"]:
            existing = list(
                m.WorkItem.objects.filter(project=project, type=kind).order_by(
                    "created_at", "number"
                )
            )
            for i in range(len(existing), self.counts[kind]):
                item = self.create_item(
                    project, kind, i, team, categories, iterations, dictionaries
                )
                existing.append(item)
                if (i + 1) % 100 == 0:
                    self.emit(f"{code} {kind} {i + 1}/{self.counts[kind]}")
            setattr(self, kind + "s", existing)
        self.create_documents(project, team)
        for iteration in iterations:
            self.at(timezone.make_aware(datetime.combine(iteration.end_date, time(18))))
            if iteration.end_date < self.anchor.date() and iteration.status != "finished":
                iteration = (
                    s.iteration_write(
                        self.actor,
                        project.id,
                        {"version": iteration.version},
                        iteration.id,
                        "start",
                    )
                    if iteration.status == "planned"
                    else iteration
                )
                s.iteration_write(
                    self.actor,
                    project.id,
                    {"version": iteration.version, "disposition": "keep", "confirm": True},
                    iteration.id,
                    "finish",
                )
            elif (
                iteration.start_date <= self.anchor.date() <= iteration.end_date
                and iteration.status == "planned"
            ):
                self.at(self.anchor - timedelta(days=13))
                s.iteration_write(
                    self.actor, project.id, {"version": iteration.version}, iteration.id, "start"
                )
        entry["complete"] = True
        self.checkpoint()
        self.emit(f"{code} 项目数据完成")

    def create_item(self, project, kind, index, team, categories, iterations, dictionaries):
        rng = self.rng(project.code, kind, index)
        iteration = iterations[index % len(iterations)] if index % 11 else None
        start = (
            iteration.start_date
            if iteration
            else self.anchor.date() - timedelta(days=rng.randrange(5, 330))
        )
        created = timezone.make_aware(
            datetime.combine(
                min(
                    start + timedelta(days=rng.randrange(0, 12)),
                    self.anchor.date() - timedelta(days=2),
                ),
                time(rng.randrange(9, 18), rng.randrange(60)),
            )
        )
        self.at(created)
        author, handler = rng.sample(team, 2)
        feature = FEATURES[index % len(FEATURES)]
        title = {
            "requirement": f"{feature}：{MODULES[index % len(MODULES)]}场景完善",
            "task": f"{feature} · {TASKS[index % len(TASKS)]}",
            "bug": f"{feature}：{BUGS[index % len(BUGS)]}",
        }[kind] + f"（第{index // len(FEATURES) + 1}轮）"
        body = f"## 背景与目标\n\n{project.name}在日常使用中，需要完善 **{feature}** 的体验与数据一致性。\n\n### 处理范围\n\n- 覆盖正常、空数据和权限不足场景\n- 保留历史数据兼容与操作追踪\n- 与业务和测试同事联合验收\n\n### 验证清单\n\n- [x] 完成业务场景梳理\n- [ ] 完成实现与回归\n\n| 场景 | 关注点 |\n| --- | --- |\n| 批量处理 | 部分失败提示 |\n| 并发操作 | 避免覆盖旧数据 |\n\n> 本记录为模拟数据，不包含真实业务信息。"
        uploads = []
        if index % 13 == 0:
            token = f"reqflow-upload:{uuid.uuid4()}"
            body += f"\n\n### 界面示意\n\n![界面示意]({token})"
            uploads = [
                (
                    token,
                    SimpleUploadedFile(
                        "界面示意.png", preview_image(index), content_type="image/png"
                    ),
                )
            ]
        data = {
            "type": kind,
            "title": title,
            "description": body,
            "priority": str(rng.choice(dictionaries["priority"]).id),
            "category": str(rng.choice(categories).id) if index % 7 else None,
            "assignee": str(handler.id),
            "iteration": str(iteration.id) if iteration else None,
            "planned_start_date": start,
            "due_date": start + timedelta(days=rng.randrange(5, 24)),
            "_uploads": uploads,
        }
        if kind == "requirement":
            data.update(
                source=rng.choice(dictionaries["source"]).code, proposer=author.display_name
            )
        elif kind == "task":
            data["requirement"] = (
                str(self.requirements[index % len(self.requirements)].id) if index % 5 else None
            )
        else:
            task = self.tasks[index % len(self.tasks)]
            data.update(
                requirement=str(self.requirements[index % len(self.requirements)].id)
                if index % 4
                else None,
                task=str(task.id) if index % 3 else None,
                environment=rng.choice(dictionaries["environment"]).code,
                severity=rng.choice(dictionaries["severity"]).code,
            )
        item = s.write_record(author, data, lambda: s.create_item(author, project.id, data))
        spec = normalized(project.workflow)[kind]
        reachable = [
            state for state in spec["states"] if self.reachable(spec, item.status, state["code"])
        ]
        old = (self.anchor - created).days > 60
        completed = [state for state in reachable if state["category"] == "completed"]
        pending = [state for state in reachable if state["category"] == "pending"]
        targets = (
            completed
            if old and index % 5 < 3 and completed
            else pending
            if start > self.anchor.date()
            else reachable
        )
        target = targets[index % len(targets)]
        path = route_to(spec, item.status, target["code"])
        if index % 17 == 0:
            self.at(created + timedelta(hours=2))
            comment = s.comment_write(
                author, item.id, {"body": f"**评审记录**\n\n{COMMENTS[index % len(COMMENTS)]}"}
            )
            if index % 34 == 0:
                self.at(created + timedelta(hours=3))
                s.comment_write(
                    author,
                    item.id,
                    {
                        "version": comment.version,
                        "body": comment.body + "\n\n补充：验收范围已经同步到本迭代。",
                    },
                    comment.id,
                )
        for step, state in enumerate(path):
            self.at(created + timedelta(days=step + 1, hours=2))
            handlers = [str(handler.id)]
            if index % 9 == 0:
                handlers.append(str(author.id))
            item = s.update_item(
                self.actor,
                item.id,
                {
                    "version": item.version,
                    "target_status": state,
                    "handlers": handlers,
                    **(
                        {
                            "body": f"{COMMENTS[(index + step) % len(COMMENTS)]}\n\n- [x] 核对本阶段交付结果"
                        }
                        if index % 19 == 0
                        else {}
                    ),
                },
                "transition",
            )
        if index % 21 == 0:
            self.at(created + timedelta(days=len(path) + 1))
            s.attachment_upload(
                handler,
                item,
                SimpleUploadedFile(
                    "回归检查清单.csv",
                    "场景,结果,备注\n权限校验,通过,覆盖跨组织访问\n空数据,通过,显示空状态\n".encode(
                        "utf-8-sig"
                    ),
                ),
            )
            s.attachment_upload(
                handler,
                item,
                SimpleUploadedFile(
                    "联调记录.txt",
                    f"{item.number}\n{title}\n联调结论：接口和页面已核对，关注历史数据兼容。".encode(),
                ),
            )
        return item

    @staticmethod
    def reachable(spec, start, target):
        try:
            route_to(spec, start, target)
            return True
        except ValueError:
            return False

    def create_documents(self, project, team):
        self.at(self.anchor - timedelta(days=330))
        folders = []
        for title in ["产品与方案", "研发与接口", "测试与发布"]:
            folders.append(
                m.Document.objects.filter(
                    project=project, document_type="folder", title=title
                ).first()
                or s.document_write(
                    self.actor, project.id, {"title": title, "document_type": "folder"}
                )
            )
        topics = [
            "产品规划",
            "业务调研纪要",
            "权限矩阵",
            "接口联调说明",
            "发布检查清单",
            "测试回归报告",
            "迭代复盘",
            "数据口径说明",
        ]
        for i in range(self.counts["documents"]):
            kind = ["docx", "xlsx", "pdf", "pptx", "md", "csv", "txt", "png"][i % 8]
            title = f"{topics[i % len(topics)]}-V{i // 8 + 1}.{kind}"
            if m.Document.objects.filter(project=project, original_name=title).exists():
                continue
            self.at(self.anchor - timedelta(days=310 - i * 11))
            payload = document_payload(kind, project.name, topics[i % len(topics)], i)
            import_document(
                team[i % len(team)],
                project.id,
                SimpleUploadedFile(title, payload),
                folders[i % 3].id if i % 4 else None,
            )

    def verify(self):
        projects = m.Project.objects.filter(id__in=[row["id"] for row in self.manifest["projects"]])
        require(projects.count() == self.counts["projects"], "项目数量不足，批次尚未完成")
        require(
            m.User.objects.filter(id__in=self.manifest["users"]).count() == self.counts["users"],
            "模拟用户数量不一致",
        )
        report = {
            "batch": self.batch,
            "users": len(self.manifest["users"]),
            "projects": [],
            "credentials_file": str(self.credentials_path),
            "generated_at": timezone.now().isoformat(),
        }
        for project in projects.order_by("code"):
            items = m.WorkItem.objects.filter(project=project)
            counts = {
                kind: items.filter(type=kind).count() for kind in ["requirement", "task", "bug"]
            }
            require(all(counts[kind] == self.counts[kind] for kind in counts), "工作项数量校验失败")
            require(not items.exclude(priority__project=project).exists(), "优先级跨项目")
            require(
                not items.filter(iteration__isnull=False)
                .exclude(iteration__project=project)
                .exists(),
                "迭代跨项目",
            )
            require(
                not items.filter(category__isnull=False)
                .exclude(category__project=project)
                .exists(),
                "分类跨项目",
            )
            for detail, field in [
                (m.TaskDetail, "requirement"),
                (m.BugDetail, "requirement"),
                (m.BugDetail, "task"),
            ]:
                require(
                    not detail.objects.filter(item__project=project, **{field + "__isnull": False})
                    .exclude(**{field + "__project": project})
                    .exists(),
                    "关联工作项跨项目",
                )
            membership = m.Member.objects.filter(project=project, deleted_at=None).values("user_id")
            require(
                not m.WorkItem.handlers.through.objects.filter(workitem__project=project)
                .exclude(user_id__in=membership)
                .exists(),
                "处理人不是当前项目成员",
            )
            attachment_parents = {
                str(key): str(parent)
                for key, parent in m.Attachment.objects.filter(project=project).values_list(
                    "id", "item_id"
                )
            }
            for item in items.iterator():
                state = next(
                    state
                    for state in normalized(project.workflow)[item.type]["states"]
                    if state["code"] == item.status
                )
                require(item.status_category == state["category"], "状态快照不一致")
                require(item.created_at <= item.updated_at <= self.anchor, "工作项历史时间异常")
                require(
                    item.completed_at is None
                    or item.created_at <= item.completed_at <= self.anchor,
                    "完成日期异常",
                )
                require("reqflow-upload:" not in item.description, "描述存在未替换图片")
                for attachment_id in re.findall(
                    r"/api/v1/attachments/([0-9a-f-]{36})", item.description
                ):
                    require(
                        attachment_parents.get(attachment_id) == str(item.id), "描述图片归属不一致"
                    )
                require(
                    (item.completed_at is not None) == (item.status_category == "completed"),
                    "完成时间不一致",
                )
            attachments = m.Attachment.objects.filter(project=project)
            for attachment in attachments.iterator():
                require(attachment.file.storage.exists(attachment.file.name), "附件文件缺失")
                require(attachment.file.size == attachment.size_bytes, "附件大小不一致")
            documents = m.Document.objects.filter(project=project).exclude(document_type="folder")
            require(documents.count() == self.counts["documents"], "文档数量校验失败")
            for document in documents:
                require(
                    document.source_file.storage.exists(document.source_file.name), "文档文件缺失"
                )
                require(document.source_file.size == document.size_bytes, "文档大小不一致")
            require(
                not m.NotificationEvent.objects.filter(
                    item__project=project, delivered_at=None
                ).exists(),
                "通知事件尚未投递",
            )
            require(
                dict(m.Counter.objects.filter(project=project).values_list("item_type", "value"))
                == counts,
                "工作项计数器异常",
            )
            report["projects"].append(
                {
                    "code": project.code,
                    "name": project.name,
                    **counts,
                    "documents": documents.count(),
                    "members": project.member_set.count(),
                    "iterations": project.iteration_set.count(),
                    "attachments": attachments.count(),
                    "comments": m.Comment.objects.filter(item__project=project).count(),
                    "inline_images": items.filter(description__contains="?inline=1").count(),
                    "audits": m.Audit.objects.filter(project=project).count(),
                    "notifications": m.Notification.objects.filter(project=project).count(),
                    "oldest_item": items.order_by("created_at").first().created_at.isoformat(),
                    "states": {
                        kind: {
                            state["code"]: items.filter(type=kind, status=state["code"]).count()
                            for state in normalized(project.workflow)[kind]["states"]
                        }
                        for kind in counts
                    },
                }
            )
        report["totals"] = {
            key: sum(project[key] for project in report["projects"])
            for key in [
                "requirement",
                "task",
                "bug",
                "documents",
                "iterations",
                "attachments",
                "comments",
                "inline_images",
                "audits",
                "notifications",
            ]
        }
        return report
