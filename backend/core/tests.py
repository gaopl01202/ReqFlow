import threading
from secrets import token_urlsafe
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from . import models as m
from . import services as s
from .policies import DEFAULT_PERMISSIONS, PERMISSIONS, DomainError
from .workflow import defaults

TEST_PASSWORD = token_urlsafe(24)
NEW_TEST_PASSWORD = token_urlsafe(24)
ANOTHER_TEST_PASSWORD = token_urlsafe(24)
WRONG_TEST_PASSWORD = token_urlsafe(24)


class AcceptanceTests(TransactionTestCase):
    def setUp(self):
        self.group = m.UserGroup.objects.create(
            name="普通用户", builtin=True, permissions=DEFAULT_PERMISSIONS
        )
        self.ag = m.UserGroup.objects.create(
            name="系统管理员", builtin=True, permissions=PERMISSIONS
        )
        self.pos = m.Position.objects.create(name="开发")
        self.admin = self.user("admin", True)
        self.a = self.user("alice")
        self.b = self.user("bob")
        self.out = self.user("outsider")
        self.priority = m.Priority.objects.get_or_create(
            project=None, kind="priority", name="中", defaults={"sort_order": 1}
        )[0]
        self.high = m.Priority.objects.get_or_create(
            project=None, kind="priority", name="高", defaults={"sort_order": 0}
        )[0]
        for kind, entries in s.DICTIONARY_DEFAULTS.items():
            for index, (code, name) in enumerate(entries):
                m.Priority.objects.get_or_create(
                    project=None, kind=kind, code=code, defaults={"name": name, "sort_order": index}
                )
        self.p = s.create_project(
            self.a, {"code": "TEST", "name": "测试项目", "owner": str(self.a.id)}
        )
        self.template_priority, self.template_high = self.priority, self.high
        self.priority = m.Priority.objects.get(project=self.p, kind="priority", name="中")
        self.high = m.Priority.objects.get(project=self.p, kind="priority", name="高")
        self.add(self.b)
        self.client = APIClient()
        self.client.force_authenticate(self.a)

    def test_project_duplicate_code_message(self):
        for user in (self.a, self.out):
            with self.assertRaisesMessage(DomainError, "项目编码已存在，请更换"):
                s.create_project(user, {"code": self.p.code, "name": "重复项目"})
        # Bypass pre-validation to exercise the database constraint used in a creation race.
        with patch.object(m.Project, "full_clean"):
            with self.assertRaisesMessage(DomainError, "项目编码已存在，请更换"):
                s.create_project(self.out, {"code": self.p.code, "name": "并发重复项目"})
        self.assertEqual(m.Project.objects.filter(code=self.p.code).count(), 1)

    def user(self, name, admin=False):
        return m.User.objects.create_user(
            username=name,
            display_name=name,
            password=TEST_PASSWORD,
            group=self.ag if admin else self.group,
            position=self.pos,
            is_superuser=admin,
            must_change_password=False,
        )

    def add(self, user, role="member"):
        return s.member_write(self.a, self.p.id, {"user": str(user.id), "role": role})

    def task(self, **kw):
        return s.create_item(
            self.a,
            self.p.id,
            {"type": "task", "title": "实现功能", "assignee": str(self.b.id), **kw},
        )

    def transition(self, item, target, **kw):
        item.refresh_from_db()
        return s.update_item(
            self.a,
            item.id,
            {"version": item.version, "target_status": target, "handlers": [str(self.b.id)], **kw},
            "transition",
        )

    def request(self, method, path, data=None, user=None):
        c = APIClient()
        c.force_authenticate(user or self.a)
        return getattr(c, method)("/api/v1/" + path, data, format="json")

    def test_L01_L05_operation_log_permissions_filters_and_revocation(self):
        self.assertEqual(self.request("get", "operation-logs").status_code, 403)
        self.assertEqual(APIClient().get("/api/v1/operation-logs").status_code, 401)
        group = m.UserGroup.objects.create(
            name="日志查看", menu_permissions=["operation-logs"], action_permissions=[]
        )
        self.b.group = group
        self.b.save()
        row = self.task(title="不应出现在运行日志中的正文")
        response = self.request(
            "get",
            f"operation-logs?resource_type=task&action=create&q={row.pk}&page_size=1",
            user=self.b,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 1)
        self.assertEqual(response.data["items"][0]["resource_id"], str(row.pk))
        self.assertEqual(response.data["items"][0]["resource_label"], "任务")
        self.assertNotIn("before", response.data["items"][0])
        self.assertNotIn("不应出现在运行日志中的正文", str(response.data))
        for query in (
            "page_size=101",
            "action=unknown",
            "date_from=bad",
            "date_from=2026-10-30&date_to=2026-10-01",
        ):
            self.assertEqual(
                self.request("get", "operation-logs?" + query, user=self.b).status_code, 422
            )
        for method in ("post", "patch", "delete"):
            self.assertEqual(
                self.request(method, "operation-logs", {}, user=self.admin).status_code, 405
            )
        group.menu_permissions = []
        group.save()
        self.assertEqual(self.request("get", "operation-logs", user=self.b).status_code, 403)

    def test_L02_L03_compact_logs_rollback_and_business_operations(self):
        from django.db import transaction

        count = m.OperationLog.objects.count()
        with self.assertRaisesMessage(RuntimeError, "rollback"):
            with transaction.atomic():
                self.task(title="事务回滚任务")
                raise RuntimeError("rollback")
        self.assertEqual(m.OperationLog.objects.count(), count)
        row = self.task(description="正文不进入运行日志")
        self.assertTrue(
            m.OperationLog.objects.filter(
                resource_id=str(row.pk), action="create", resource_type="task"
            ).exists()
        )
        row = s.update_item(self.a, row.pk, {"version": row.version, "title": "编辑"})
        self.assertTrue(
            m.OperationLog.objects.filter(resource_id=str(row.pk), action="update").exists()
        )
        s.update_item(self.a, row.pk, {"version": row.version}, "delete")
        self.assertTrue(
            m.OperationLog.objects.filter(resource_id=str(row.pk), action="delete").exists()
        )
        row.refresh_from_db()
        s.update_item(self.a, row.pk, {"version": row.version}, "restore")
        self.assertTrue(
            m.OperationLog.objects.filter(resource_id=str(row.pk), action="restore").exists()
        )
        self.assertEqual(
            set(f.name for f in m.OperationLog._meta.fields),
            {"id", "actor", "project", "action", "resource_type", "resource_id", "created_at"},
        )

    def test_L04_authentication_operations_compact_log(self):
        client = APIClient()
        token = client.get("/api/v1/auth/csrf").data["csrf_token"]
        response = client.post(
            "/api/v1/auth/login",
            {"username": self.b.username, "password": TEST_PASSWORD},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(m.OperationLog.objects.filter(actor=self.b, action="login").exists())
        response = client.post(
            "/api/v1/auth/change-password",
            {"old_password": TEST_PASSWORD, "password": NEW_TEST_PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            m.OperationLog.objects.filter(actor=self.b, action="change_password").exists()
        )
        self.assertEqual(client.post("/api/v1/auth/logout").status_code, 204)
        self.assertTrue(m.OperationLog.objects.filter(actor=self.b, action="logout").exists())
        self.b.refresh_from_db()
        s.user_write(self.admin, {"version": self.b.version}, self.b.pk, "reset-password")
        self.b.refresh_from_db()
        s.user_write(self.admin, {"version": self.b.version}, self.b.pk, "deactivate")
        self.assertTrue(
            m.OperationLog.objects.filter(
                actor=self.admin, resource_id=str(self.b.pk), action="reset-password"
            ).exists()
        )
        self.assertTrue(
            m.OperationLog.objects.filter(
                actor=self.admin, resource_id=str(self.b.pk), action="deactivate"
            ).exists()
        )

    def test_UI74_session_rolling_activity_and_legacy_expiry(self):
        from django.conf import settings

        from .sessions import ACTIVITY, STARTED

        client = APIClient()

        def signin():
            self.assertTrue(
                client.login(username=self.a.username, password=TEST_PASSWORD)
            )

        signin()
        session = client.session
        started, activity = session[STARTED], session[ACTIVITY]
        absolute = session.get_expiry_date()
        self.assertEqual(client.get("/api/v1/projects").status_code, 200)
        self.assertEqual(client.session[ACTIVITY], activity)
        self.assertEqual(client.post("/api/v1/auth/activity", {}, format="json").status_code, 200)
        self.assertEqual(client.session[STARTED], started)
        self.assertGreater(client.session.get_expiry_date(), absolute)
        session = client.session
        session[ACTIVITY] = timezone.now().timestamp() - settings.SESSION_IDLE_TIMEOUT_SECONDS - 1
        session.save()
        denied = client.post("/api/v1/auth/activity", {}, format="json")
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(
            denied.data["code"] if hasattr(denied, "data") else denied.json()["code"],
            "SESSION_EXPIRED",
        )
        self.assertEqual(client.get("/api/v1/projects").status_code, 401)
        signin()
        session = client.session
        session[STARTED] = timezone.now().timestamp() - 90 * 86400
        session[ACTIVITY] = timezone.now().timestamp()
        session.save()
        self.assertEqual(client.get("/api/v1/auth/me").status_code, 200)
        signin()
        session = client.session
        del session[STARTED]
        session.save()
        self.assertEqual(client.get("/api/v1/auth/me").status_code, 401)
        signin()
        self.assertGreater(
            client.get("/api/v1/auth/me").data["session_expires_at"], timezone.now().timestamp()
        )

    def test_UI74_activity_in_another_tab_extends_idle(self):
        from django.conf import settings

        from .sessions import ACTIVITY, STARTED

        first = APIClient()
        self.assertTrue(first.login(username=self.a.username, password=TEST_PASSWORD))
        original_start = first.session[STARTED]
        session = first.session
        session[ACTIVITY] = timezone.now().timestamp() - settings.SESSION_IDLE_TIMEOUT_SECONDS + 10
        session.save()
        old_deadline = first.get("/api/v1/auth/me").data["session_expires_at"]
        second = APIClient()
        second.cookies = first.cookies.copy()
        self.assertEqual(second.post("/api/v1/auth/activity", {}, format="json").status_code, 200)
        self.assertGreater(first.get("/api/v1/auth/me").data["session_expires_at"], old_deadline)
        self.assertEqual(first.session[STARTED], original_start)

    def test_session_revocation_logout_reset_and_deactivation(self):
        from django.contrib.sessions.models import Session

        for action in ("logout", "reset-password", "deactivate"):
            user = self.user("s-" + action)
            clients = [APIClient(), APIClient()]
            for client in clients:
                self.assertTrue(
                    client.login(username=user.username, password=TEST_PASSWORD)
                )
            keys = [client.session.session_key for client in clients]
            if action == "logout":
                self.assertEqual(clients[0].post("/api/v1/auth/logout").status_code, 204)
                self.assertFalse(Session.objects.filter(session_key=keys[0]).exists())
                self.assertEqual(clients[1].get("/api/v1/auth/me").status_code, 200)
            else:
                s.user_write(self.admin, {"version": user.version}, user.id, action)
                self.assertFalse(Session.objects.filter(session_key__in=keys).exists())
            self.assertEqual(clients[0].get("/api/v1/auth/me").status_code, 401)

    def test_UI74_short_link_resolution_scope_type_soft_delete_and_metadata(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from .document_files import import_document
        from .links import web_url

        anonymous = APIClient()
        for kind in ["requirement", "task", "bug"]:
            item = s.create_item(self.a, self.p.id, {"type": kind, "title": kind})
            path = f"links/{self.p.code}/{kind}/1"
            self.assertEqual(web_url(item), f"/p/{self.p.code}/{kind}/1")
            self.assertEqual(anonymous.get("/api/v1/" + path).status_code, 401)
            resolved = self.request("get", path, user=self.b)
            self.assertEqual(resolved.status_code, 200)
            self.assertEqual(resolved.data["id"], str(item.id))
            self.assertEqual(self.request("get", path, user=self.out).status_code, 404)
            self.assertEqual(self.request("get", f"links/UNKNOWN/{kind}/1").status_code, 404)
            if kind == "task":
                attachment = s.attachment_upload(
                    self.a, item, SimpleUploadedFile("share.txt", b"private")
                )
                metadata = f"attachments/{attachment.id}/metadata"
                self.assertEqual(anonymous.get("/api/v1/" + metadata).status_code, 401)
                self.assertEqual(self.request("get", metadata).data["original_name"], "share.txt")
                self.assertEqual(self.request("get", metadata, user=self.out).status_code, 404)
                s.update_item(self.a, item.id, {"version": item.version, "confirm": True}, "delete")
                self.assertEqual(self.request("get", path).status_code, 404)
        document = import_document(self.a, self.p.id, SimpleUploadedFile("share.txt", b"document"))
        self.assertEqual(
            self.request("get", f"links/{self.p.code}/document/{document.id}").data["id"],
            str(document.id),
        )
        iteration = s.iteration_write(
            self.a,
            self.p.id,
            {
                "name": "share iteration",
                "owner": str(self.a.id),
                "start_date": "2030-01-01",
                "end_date": "2030-01-14",
            },
        )
        self.assertEqual(
            self.request("get", f"links/{self.p.code}/iteration/{iteration.id}").data["id"],
            str(iteration.id),
        )
        self.assertEqual(
            self.request("get", f"links/{self.p.code}/document/not-a-uuid").status_code, 404
        )
        self.group.menu_permissions = ["documents"]
        self.group.save()
        self.a.refresh_from_db()
        self.assertEqual(self.request("get", f"links/{self.p.code}/requirement/1").status_code, 403)
        self.assertEqual(
            self.request("get", f"links/{self.p.code}/document/{document.id}").status_code, 200
        )

    def test_UI73_delegated_user_management_and_administrator_protection(self):
        self.group.menu_permissions = ["users"]
        self.group.action_permissions = [
            "users:create",
            "users:edit",
            "users:toggle",
            "users:reset_password",
            "users:delete",
        ]
        self.group.save()
        self.a.refresh_from_db()
        created = self.request(
            "post",
            "users",
            {
                "username": "delegated-created",
                "display_name": "授权创建",
                "group": str(self.group.id),
                "position": str(self.pos.id),
            },
        )
        self.assertEqual(created.status_code, 201)
        target = m.User.objects.get(pk=created.data["id"])
        edited = self.request(
            "patch", f"users/{target.id}", {"version": target.version, "display_name": "授权修改"}
        )
        self.assertEqual(edited.status_code, 200)
        for action, method in [("", "patch"), ("deactivate", "post"), ("reset-password", "post")]:
            url = f"users/{self.admin.id}" + (f"/{action}" if action else "")
            self.assertEqual(
                self.request(
                    method, url, {"version": self.admin.version, "display_name": "不能改"}
                ).status_code,
                403,
            )
        target.refresh_from_db()
        self.assertEqual(
            self.request(
                "patch", f"users/{target.id}", {"version": target.version, "group": str(self.ag.id)}
            ).status_code,
            403,
        )
        self.group.action_permissions = []
        self.group.save()
        self.a.refresh_from_db()
        self.assertEqual(self.request("get", "users").status_code, 200)
        self.assertEqual(
            self.request(
                "patch",
                f"users/{target.id}",
                {"version": target.version, "display_name": "撤权后拒绝"},
            ).status_code,
            403,
        )
        target.refresh_from_db()
        self.assertEqual(target.display_name, "授权修改")

    def test_UI73_action_validation_project_roles_and_service_denial(self):
        task = self.task()
        for payload in [
            {"menu_permissions": ["users"], "action_permissions": ["users:unknown"]},
            {"menu_permissions": ["users"], "action_permissions": ["users:edit", "users:edit"]},
            {"menu_permissions": ["home"], "action_permissions": ["users:edit"]},
        ]:
            with self.assertRaises(DomainError):
                s.config_write(self.admin, m.UserGroup, {"name": "非法权限", **payload})
        self.group.menu_permissions = ["items", "users", "user-groups", "positions"]
        self.group.action_permissions = [
            "items:categories",
            "items:edit",
            "positions:create",
            "user-groups:edit",
        ]
        self.group.save()
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        self.assertEqual(
            self.request(
                "post", f"projects/{self.p.id}/categories", {"name": "管理员分类"}
            ).status_code,
            201,
        )
        self.assertEqual(
            self.request(
                "post", f"projects/{self.p.id}/categories", {"name": "成员不许"}, user=self.b
            ).status_code,
            403,
        )
        self.assertEqual(self.request("post", "positions", {"name": "授权职务"}).status_code, 201)
        with self.assertRaises(DomainError):
            s.user_write(
                self.a,
                {"username": "不能绕过", "group": str(self.group.id), "position": str(self.pos.id)},
            )
        self.assertEqual(
            self.request(
                "patch",
                f"user-groups/{self.ag.id}",
                {"version": self.ag.version, "action_permissions": [], "menu_permissions": []},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request(
                "patch", f"work-items/{task.id}", {"version": task.version, "title": "项目成员可改"}
            ).status_code,
            200,
        )
        m.Member.objects.filter(project=self.p, user=self.b).update(role="readonly")
        self.assertEqual(
            self.request(
                "patch",
                f"work-items/{task.id}",
                {"version": task.version, "title": "只读仍禁止"},
                user=self.b,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request(
                "delete", f"work-items/{task.id}", {"version": task.version, "confirm": True}
            ).status_code,
            403,
        )

    def test_UI73_dictionary_toggle_is_separate_and_template_configuration(self):
        self.group.menu_permissions = ["priorities", "workflow-template"]
        self.group.action_permissions = ["priorities:toggle", "workflow-template:configure"]
        self.group.save()
        self.a.refresh_from_db()
        response = self.request(
            "patch",
            f"dictionaries/{self.template_high.id}",
            {"version": self.template_high.version, "enabled": False},
        )
        self.assertEqual(response.status_code, 200)
        self.template_high.refresh_from_db()
        self.assertFalse(self.template_high.enabled)
        mixed = self.request(
            "patch",
            f"dictionaries/{self.template_high.id}",
            {"version": self.template_high.version, "enabled": True, "name": "不能改名"},
        )
        self.assertEqual(mixed.status_code, 403)
        self.template_high.refresh_from_db()
        self.assertFalse(self.template_high.enabled)
        template = self.request("get", "workflow-template").data
        self.assertEqual(self.request("patch", "workflow-template", template).status_code, 200)
        self.group.action_permissions = []
        self.group.save()
        self.a.refresh_from_db()
        self.assertEqual(self.request("patch", "workflow-template", template).status_code, 403)

    def test_UI58_menu_scope_context_and_function_permissions_preserved(self):
        from .policies import menu_permissions

        existing = list(self.group.permissions)
        saved = s.config_write(
            self.admin,
            m.UserGroup,
            {"version": self.group.version, "menu_permissions": ["home", "items"]},
            self.group.id,
        )
        self.assertEqual(saved.permissions, existing)
        self.a.refresh_from_db()
        self.assertEqual(menu_permissions(self.a), ["home", "items"])
        self.assertEqual(self.request("get", f"projects/{self.p.id}/work-items").status_code, 200)
        self.assertEqual(self.request("get", f"projects/{self.p.id}/documents").status_code, 403)
        self.assertEqual(
            self.request("get", f"projects/{self.p.id}/reports/overview").status_code, 403
        )
        self.assertEqual(self.request("get", f"projects/{self.p.id}/members").status_code, 403)
        context = self.request("get", f"projects/{self.p.id}/context")
        self.assertEqual(context.status_code, 200)
        self.assertEqual(context.data["project"]["id"], str(self.p.id))
        self.assertTrue(context.data["dictionaries"])
        self.assertEqual(
            {row["display_name"] for row in context.data["members"]},
            {self.a.display_name, self.b.display_name},
        )
        self.assertEqual(
            self.request(
                "post", f"projects/{self.p.id}/categories", {"name": "菜单内分类"}
            ).status_code,
            201,
        )
        self.assertEqual(
            self.request("get", f"projects/{self.p.id}/context", user=self.out).status_code, 404
        )
        self.assertEqual(self.request("get", "users").status_code, 403)
        for flags in [["not-a-menu"], ["home", "home"]]:
            with self.assertRaises(DomainError):
                s.config_write(
                    self.admin,
                    m.UserGroup,
                    {"version": saved.version, "menu_permissions": flags},
                    saved.id,
                )
        s.config_write(
            self.admin,
            m.UserGroup,
            {"version": saved.version, "menu_permissions": ["users"]},
            saved.id,
        )
        self.a.refresh_from_db()
        self.assertEqual(self.request("get", "users").status_code, 200)
        self.assertEqual(self.request("get", "workspace/context").status_code, 200)
        self.assertEqual(self.request("post", "users", {"username": "forbidden"}).status_code, 403)
        self.assertEqual(self.request("get", "me/dashboard").status_code, 403)
        self.assertEqual(self.request("get", "auth/me").data["menu_permissions"], ["users"])
        self.assertIn(
            "user-groups", self.request("get", "auth/me", user=self.admin).data["menu_permissions"]
        )

    def test_UI58_workbench_counts_and_click_scopes(self):
        today = timezone.localdate()
        for title, due in [
            ("今日待办", today),
            ("逾期待办", today - timedelta(days=1)),
            ("未来待办", today + timedelta(days=2)),
        ]:
            self.task(title=title, due_date=str(due))
        # Another person's item must not appear in these metrics or scopes.
        self.task(title="其他人事项", assignee=str(self.a.id), due_date=str(today))
        overview = self.request("get", "me/dashboard", user=self.b).data
        self.assertEqual(
            (overview["unfinished"], overview["due_today"], overview["overdue"]), (3, 1, 1)
        )
        self.assertEqual(sum(row["count"] for row in overview["types"]), 3)
        self.assertEqual(overview["project_progress"][0]["unfinished"], 3)
        for scope, count, title in [
            ("all", 3, None),
            ("today", 1, "今日待办"),
            ("overdue", 1, "逾期待办"),
        ]:
            result = self.request("get", f"me/todos?todo_scope={scope}", user=self.b)
            self.assertEqual(result.data["total"], count)
            if title:
                self.assertEqual(result.data["items"][0]["title"], title)
        self.assertEqual(
            self.request("get", "me/todos?todo_scope=invalid", user=self.b).status_code, 422
        )
        group = s.config_write(
            self.admin, m.UserGroup, {"name": "新菜单用户组", "menu_permissions": ["home"]}
        )
        self.assertEqual(group.permissions, DEFAULT_PERMISSIONS)
        self.assertEqual(group.menu_permissions, ["home"])

    def test_UI57_report_tables_scope_labels_and_formula_safety(self):
        import csv
        import io

        item = self.task(title="唯一报表标题")
        bug = s.create_item(
            self.a,
            self.p.id,
            {
                "type": "bug",
                "title": "筛选外缺陷",
                "handlers": [str(self.a.id), str(self.b.id)],
                "severity": "normal",
            },
        )
        overview = self.request("get", f"projects/{self.p.id}/reports/overview").data
        self.assertEqual(sum(row["count"] for row in overview["severities"]), 1)
        self.assertEqual(sum(row["count"] for row in overview["bugs"]), 2)
        self.b.display_name = "=危险公式"
        self.b.save()
        for table, header in [("states", "类型"), ("bugs", "状态"), ("members", "处理人")]:
            response = self.request("get", f"projects/{self.p.id}/reports/export?table={table}")
            self.assertEqual(response.status_code, 200)
            rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
            self.assertEqual(rows[0][0], header)
            if table == "members":
                self.assertTrue(any(row[0] == "'=危险公式" for row in rows[1:]))
            filtered = self.request(
                "get", f"projects/{self.p.id}/reports/export?table={table}&q={item.title}"
            )
            self.assertEqual(filtered.status_code, 200)
            filtered_rows = list(csv.reader(io.StringIO(filtered.content.decode("utf-8-sig"))))
            if table == "bugs":
                self.assertEqual(len(filtered_rows), 1)
            if table == "states":
                self.assertEqual(filtered_rows[1], ["任务", "待开始", "1"])
            self.assertEqual(
                self.request(
                    "get", f"projects/{self.p.id}/reports/export?table={table}", user=self.out
                ).status_code,
                404,
            )
        self.assertEqual(
            self.request("get", f"projects/{self.p.id}/reports/export?table=other").status_code, 422
        )
        self.assertEqual(bug.type, "bug")
        member = m.Member.objects.get(project=self.p, user=self.b)
        member.role = "readonly"
        member.save()
        for table in ["members", "states", "bugs"]:
            self.assertEqual(
                self.request(
                    "get", f"projects/{self.p.id}/reports/export?table={table}", user=self.b
                ).status_code,
                403,
            )

    def test_UI57_enabled_config_version_and_project_permissions(self):
        position = s.config_write(self.admin, m.Position, {"name": "测试启停职务"})
        position = s.config_write(
            self.admin, m.Position, {"version": position.version, "enabled": False}, position.id
        )
        old_version = position.version
        position = s.config_write(
            self.admin, m.Position, {"version": position.version, "name": "改名仍停用"}, position.id
        )
        self.assertFalse(position.enabled)
        with self.assertRaises(DomainError):
            s.config_write(
                self.admin, m.Position, {"version": old_version, "enabled": True}, position.id
            )
        priority = m.Priority.objects.filter(project=self.p, kind="priority", enabled=True).first()
        with self.assertRaises(DomainError):
            s.config_write(
                self.b,
                m.Priority,
                {"version": priority.version, "enabled": False},
                priority.id,
                self.p.id,
            )

    def test_UI56_leaf_reactivation_all_types(self):
        from copy import deepcopy

        workflow = deepcopy(self.p.workflow)
        for spec in workflow.values():
            terminal = {state["code"] for state in spec["states"] if state["category"] != "pending"}
            spec["transitions"] = [
                edge for edge in spec["transitions"] if edge["from"] not in terminal
            ]
        self.p = s.workflow_write(
            self.a, self.p.id, {"version": self.p.version, "workflow": workflow}
        )
        for kind, path in [
            ("requirement", ["ready", "active", "review", "done"]),
            ("task", ["active", "review", "done"]),
            ("bug", ["ready", "active", "review", "closed"]),
        ]:
            with self.subTest(kind=kind):
                item = s.create_item(
                    self.a,
                    self.p.id,
                    {"type": kind, "title": "重新激活验证", "assignee": str(self.b.id)},
                )
                for target in path:
                    item = self.transition(item, target)
                self.assertIsNotNone(item.completed_at)
                result = self.request(
                    "post",
                    f"work-items/{item.id}/transition",
                    {
                        "version": item.version,
                        "target_status": "active",
                        "reactivate": True,
                        "handlers": [str(self.a.id), str(self.b.id)],
                        "body": "**重新处理**：补充回归验证",
                    },
                )
                self.assertEqual(result.status_code, 200, result.data)
                item.refresh_from_db()
                self.assertEqual(item.status_category, "pending")
                self.assertIsNone(item.completed_at)
                self.assertEqual(set(s.handler_ids(item)), {self.a.id, self.b.id})
                self.assertTrue(
                    m.Comment.objects.filter(item=item, workflow_status="active").exists()
                )
                event = m.Audit.objects.get(entity_id=str(item.id), action="reactivate")
                self.assertIsNotNone(event.before["completed_at"])
                self.assertIsNone(event.after["completed_at"])
                self.p.refresh_from_db()
                self.assertEqual(self.p.workflow, workflow)
                if kind == "bug":
                    detail = m.BugDetail.objects.get(item=item)
                    self.assertIsNone(detail.submitted_at)
                    self.assertIsNone(detail.submitted_by)
                    self.assertIsNone(detail.verified_at)
                    self.assertIsNone(detail.verified_by)

    def test_UI56_reactivation_validates_leaf_target_handlers_and_permissions(self):
        task = self.task()
        payload = {
            "version": task.version,
            "target_status": "active",
            "reactivate": True,
            "handlers": [str(self.b.id)],
        }
        self.assertEqual(
            self.request("post", f"work-items/{task.id}/transition", payload).status_code, 422
        )
        task = self.transition(task, "cancelled")
        payload["version"] = task.version
        for target in ["done", "cancelled", "unknown"]:
            self.assertEqual(
                self.request(
                    "post", f"work-items/{task.id}/transition", {**payload, "target_status": target}
                ).status_code,
                422,
            )
        self.assertEqual(
            self.request(
                "post", f"work-items/{task.id}/transition", {**payload, "handlers": []}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.request(
                "post", f"work-items/{task.id}/transition", {**payload, "version": task.version - 1}
            ).status_code,
            409,
        )
        self.assertEqual(
            self.request(
                "post", f"work-items/{task.id}/transition", payload, user=self.out
            ).status_code,
            404,
        )
        self.add(self.out, "readonly")
        self.assertEqual(
            self.request(
                "post", f"work-items/{task.id}/transition", payload, user=self.out
            ).status_code,
            403,
        )
        # The explicit flag is necessary; normal transitions cannot bypass configured edges.
        self.assertEqual(
            self.request(
                "post", f"work-items/{task.id}/transition", {**payload, "reactivate": False}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.request(
                "post", f"work-items/{task.id}/transition", {**payload, "target_status": "ready"}
            ).status_code,
            200,
        )

    def test_UI56_reactivation_comment_failure_rolls_back(self):
        from unittest.mock import patch

        task = self.transition(self.task(), "cancelled")
        old_version = task.version
        counts = [model.objects.count() for model in [m.Audit, m.NotificationEvent, m.Comment]]
        with patch("core.services.comment_write", side_effect=RuntimeError("simulated failure")):
            with self.assertRaises(RuntimeError):
                s.update_item(
                    self.a,
                    task.id,
                    {
                        "version": task.version,
                        "target_status": "active",
                        "reactivate": True,
                        "handlers": [str(self.a.id)],
                        "body": "回归说明",
                    },
                    "transition",
                )
        task.refresh_from_db()
        self.assertEqual((task.status, task.version), ("cancelled", old_version))
        self.assertEqual(s.handler_ids(task), [self.b.id])
        self.assertEqual(
            [model.objects.count() for model in [m.Audit, m.NotificationEvent, m.Comment]], counts
        )

    def test_DEV01_work_item_reads_are_batched_and_equivalent(self):
        from django.test.utils import CaptureQueriesContext

        from .querysets import work_item_rows
        from .serializers import serialize

        requirement = s.create_item(
            self.a, self.p.id, {"type": "requirement", "title": "批量读取需求"}
        )
        task = self.task(requirement=str(requirement.id))
        for target in ["active", "review", "done"]:
            task = self.transition(task, target)
        for index in range(5):
            self.task(title=f"其他任务{index}", requirement=str(requirement.id))
        s.create_item(
            self.a,
            self.p.id,
            {"type": "bug", "title": "关联缺陷", "requirement": str(requirement.id)},
        )
        source = m.WorkItem.objects.filter(project=self.p).order_by("number")
        expected = [serialize(item) for item in source]
        with CaptureQueriesContext(connection) as queries:
            actual = [serialize(item) for item in work_item_rows(source)]
        self.assertEqual(actual, expected)
        self.assertEqual(len(queries), 2)
        row = next(item for item in actual if item["type"] == "requirement")
        self.assertEqual(row["child_task_total"], 6)
        self.assertEqual(row["child_task_completed"], 1)
        s.update_item(self.a, task.id, {"version": task.version}, "delete")
        row = serialize(work_item_rows(m.WorkItem.objects.filter(pk=requirement.pk)).get())
        self.assertEqual(row["child_task_total"], 5)
        self.assertEqual(row["child_task_completed"], 0)

    def test_DEV01_demo_scenario_isolated_and_repeatable(self):
        import json
        import tempfile
        from pathlib import Path

        from django.test import override_settings

        from .demo_data import DemoScenario

        counts = {"users": 16, "projects": 1, "requirement": 2, "task": 2, "bug": 2, "documents": 2}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with override_settings(MEDIA_ROOT=root / "files"):
                scenario = DemoScenario(
                    self.admin, "demotest", counts, root / "batch", emit=lambda _: None
                )
                report = scenario.run()
                self.assertEqual(report["users"], 16)
                project = m.Project.objects.get(code="DEMOTEST-01")
                self.assertEqual(m.WorkItem.objects.filter(project=project).count(), 6)
                self.assertEqual(m.WorkItem.objects.filter(project=self.p).count(), 0)
                self.assertEqual(m.Iteration.objects.filter(project=project).count(), 12)
                self.assertTrue(
                    m.TaskDetail.objects.filter(
                        item__project=project, requirement__isnull=False
                    ).exists()
                )
                pictured = m.WorkItem.objects.filter(
                    project=project, description__contains="?inline=1"
                )
                self.assertEqual(pictured.count(), 3)
                self.assertFalse(pictured.filter(description__contains="reqflow-upload:").exists())
                self.assertTrue(m.Comment.objects.filter(item__project=project).exists())
                self.assertTrue(
                    m.Audit.objects.filter(project=project, action="transition").exists()
                )
                self.assertTrue(m.Notification.objects.filter(project=project).exists())
                self.assertFalse(
                    m.WorkItem.objects.filter(
                        project=project, created_at__gt=timezone.now()
                    ).exists()
                )
                for row in json.loads((root / "batch/credentials.json").read_text()):
                    user = m.User.objects.get(username=row["username"])
                    self.assertTrue(user.check_password(row["password"]))
                    self.assertFalse(user.must_change_password)
                self.assertEqual((root / "batch/credentials.json").stat().st_mode & 0o777, 0o600)
                before = m.Audit.objects.count()
                resumed = DemoScenario(
                    self.admin, "demotest", counts, root / "batch", emit=lambda _: None
                ).run()
                self.assertEqual(resumed["projects"], report["projects"])
                self.assertEqual(m.Audit.objects.count(), before)

    def test_DEV01_demo_command_rejects_production(self):
        from django.core.management import call_command
        from django.core.management.base import CommandError
        from django.test import override_settings

        with override_settings(DEBUG=False), self.assertRaises(CommandError):
            call_command("seed_demo", actor=self.admin.username)

    def test_UI55_member_and_notification_search(self):
        self.b.display_name = "测试成员"
        self.b.save(update_fields=["display_name"])
        for term in ["bob", "测试成员"]:
            result = self.request("get", f"projects/{self.p.id}/members?q={term}")
            self.assertEqual(result.data["total"], 1)
        result = self.request("get", f"projects/{self.p.id}/members?q=outsider")
        self.assertEqual(result.data["total"], 0)
        item = self.task()
        m.Notification.objects.filter(recipient=self.a).delete()
        m.Notification.objects.create(
            recipient=self.a,
            project=self.p,
            item=item,
            event_type="assignment",
            message="搜索通知验证",
            dedupe_key="search-check",
        )
        self.assertEqual(self.request("get", "me/notifications?q=通知验证").data["total"], 1)
        self.assertEqual(self.request("get", "me/notifications?q=未匹配内容").data["total"], 0)
        self.assertEqual(
            self.request("get", "me/notifications?q=通知验证", user=self.out).data["total"], 0
        )

    def test_UI60_notification_descriptions_and_read_scope(self):
        from .notification_text import EVENT_LABELS, notification_message

        item = self.task()
        m.Notification.objects.all().delete()
        for kind, label in EVENT_LABELS.items():
            row = m.Notification.objects.create(
                recipient=self.a,
                project=self.p,
                item=item,
                event_type=kind,
                message=f"{item.number} bug 排查： {kind}",
                dedupe_key=f"ui60-{kind}",
            )
            result = self.request("get", f"me/notifications?q={label}")
            self.assertEqual(result.data["total"], 1)
            self.assertEqual(result.data["items"][0]["message"], f"{item.number} bug 排查：{label}")
            row.refresh_from_db()
            self.assertTrue(row.message.endswith(kind))
            self.assertEqual(notification_message("自定义通知", kind), "自定义通知")
        other = m.Notification.objects.create(
            recipient=self.b,
            project=self.p,
            item=item,
            event_type="comment",
            message="其他成员的通知",
            dedupe_key="ui60-other",
        )
        self.assertEqual(self.request("get", "me/notifications", user=self.out).data["total"], 0)
        result = self.request("post", "me/notifications/mark-all-read", {})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(m.Notification.objects.filter(recipient=self.a, read_at=None).exists())
        other.refresh_from_db()
        self.assertIsNone(other.read_at)
        s.notify(item, "status", actor=self.b, recipients=[self.a.id], key="ui60-delivery")
        self.assertTrue(
            m.Notification.objects.get(dedupe_key="ui60-delivery").message.endswith(
                "工作流状态已变更"
            )
        )

    def test_P01_W01_T01_defaults_audit(self):
        t = self.task()
        self.assertEqual(t.number, "TEST-T-1")
        self.assertEqual(t.status, "ready")
        self.assertTrue(m.Audit.objects.filter(entity_id=str(t.id), action="create").exists())
        self.assertEqual(self.request("get", "me/todos", user=self.b).data["total"], 1)

    def test_P02_member_handover_atomic(self):
        t = self.task()
        member = m.Member.objects.get(project=self.p, user=self.b)
        with self.assertRaises(DomainError):
            s.member_write(self.a, self.p.id, {"version": member.version}, self.b.id, True)
        t.refresh_from_db()
        self.assertEqual(t.assignee, self.b)
        s.member_write(
            self.a,
            self.p.id,
            {"version": member.version, "unfinished_items": {"action": "unassign"}},
            self.b.id,
            True,
        )
        t.refresh_from_db()
        self.assertIsNone(t.assignee)
        self.assertEqual(
            self.request("get", "work-items/" + str(t.id), user=self.b).status_code, 404
        )
        self.assertEqual(self.request("get", "me/todos", user=self.b).data["total"], 0)

    def test_P03_closed_project_even_admin(self):
        t = self.task()
        s.update_project(self.a, self.p.id, {"version": self.p.version}, "close")
        with self.assertRaises(DomainError):
            s.update_item(self.admin, t.id, {"version": t.version, "title": "绕过"})
        self.p.refresh_from_db()
        s.update_project(self.a, self.p.id, {"version": self.p.version}, "reopen")
        s.update_item(self.a, t.id, {"version": t.version, "title": "可修改"})

    def test_Q01_Q02_Q03_access_and_group_immediate(self):
        t = self.task()
        self.assertEqual(
            self.request("get", "work-items/" + str(t.id), user=self.out).status_code,
            404,
        )
        member = m.Member.objects.get(project=self.p, user=self.b)
        member.role = "readonly"
        member.save()
        self.assertEqual(
            self.request(
                "patch",
                "work-items/" + str(t.id),
                {"version": t.version, "title": "越权"},
                self.b,
            ).status_code,
            403,
        )
        self.group.permissions = ["view_project"]
        self.group.save()
        self.a.refresh_from_db()
        self.assertEqual(
            self.request(
                "patch",
                "work-items/" + str(t.id),
                {"version": t.version, "title": "越权"},
            ).status_code,
            403,
        )

    def test_W02_partial_bulk(self):
        t = self.task()
        second = s.create_project(self.out, {"code": "OTHER", "name": "其他"})
        hidden = s.create_item(self.out, second.id, {"type": "task", "title": "隐藏"})
        res = self.request(
            "post",
            "work-items/bulk-update",
            {
                "items": [
                    {"id": str(t.id), "version": t.version},
                    {"id": str(hidden.id), "version": hidden.version},
                ],
                "changes": {"priority": str(self.high.id)},
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["success_count"], 1)
        self.assertEqual(res.data["failure_count"], 1)

    def test_W03_delete_restore_reports(self):
        t = self.task()
        s.update_item(self.a, t.id, {"version": t.version}, "delete")
        self.assertEqual(self.request("get", "work-items/" + str(t.id)).status_code, 404)
        self.assertEqual(
            self.request("get", f"projects/{self.p.id}/reports/overview").data["total"],
            0,
        )
        t.refresh_from_db()
        s.update_item(self.a, t.id, {"version": t.version}, "restore")
        self.assertEqual(self.request("get", "work-items/" + str(t.id)).status_code, 200)

    def test_W01_members_edit_others_items_but_only_creator_or_admin_deletes(self):
        for kind in ["requirement", "task", "bug"]:
            with self.subTest(kind=kind):
                item = s.create_item(self.a, self.p.id, {"type": kind, "title": "他人创建"})
                path = f"work-items/{item.id}"
                response = self.request(
                    "patch", path, {"version": item.version, "title": "成员编辑"}, self.b
                )
                self.assertEqual(response.status_code, 200)
                item.refresh_from_db()
                self.assertEqual(item.title, "成员编辑")
                denied = self.request("delete", path, {"version": item.version}, self.b)
                self.assertEqual(denied.status_code, 403)
                item.refresh_from_db()
                self.assertIsNone(item.deleted_at)
                self.assertEqual(
                    self.request("delete", path, {"version": item.version}).status_code, 204
                )

    def test_W01_transition_requires_handlers_without_changing_item(self):
        item = s.create_item(self.a, self.p.id, {"type": "task", "title": "未分配"})
        response = self.request(
            "post",
            f"work-items/{item.id}/transition",
            {"version": item.version, "target_status": "active", "handlers": []},
            self.b,
        )
        self.assertEqual(response.status_code, 422)
        item.refresh_from_db()
        self.assertEqual(item.status, "ready")
        self.assertEqual(item.version, 1)

    def test_W03_project_recycle_bin_scope_and_restore_permission(self):
        deleted = []
        for kind in ["requirement", "task", "bug"]:
            item = s.create_item(self.a, self.p.id, {"type": kind, "title": kind})
            s.update_item(self.a, item.id, {"version": item.version}, "delete")
            deleted.append(str(item.id))
        self.task()
        other = s.create_project(
            self.a, {"code": "OTHER", "name": "其他项目", "owner": str(self.a.id)}
        )
        item = s.create_item(self.a, other.id, {"type": "task", "title": "其他项目"})
        s.update_item(self.a, item.id, {"version": item.version}, "delete")
        path = f"projects/{self.p.id}/recycle-bin"
        response = self.request("get", path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data["items"]], deleted[::-1])
        self.assertTrue(all(row["can_restore"] for row in response.data["items"]))
        member_response = self.request("get", path, user=self.b)
        self.assertEqual(member_response.status_code, 200)
        self.assertEqual(member_response.data["total"], 3)
        self.assertFalse(any(row["can_restore"] for row in member_response.data["items"]))
        self.assertEqual(self.request("get", path, user=self.out).status_code, 404)

    def test_R01_R02_requirement_confirmation(self):
        req = s.create_item(
            self.a,
            self.p.id,
            {
                "type": "requirement",
                "title": "需求",
                "description": "详情",
                "priority": str(self.priority.id),
            },
        )
        self.task(requirement=str(req.id))
        for state in ["ready", "active", "review"]:
            self.transition(req, state)
        self.transition(req, "done")
        self.assertEqual(m.WorkItem.objects.get(pk=req.pk).status, "done")
        self.assertEqual(m.TaskDetail.objects.get(requirement=req).item.status, "ready")

    def test_T02_reopen_reason_completion_history(self):
        t = self.task()
        for state in ["active", "review", "done"]:
            self.transition(t, state)
        self.transition(t, "active")
        t.refresh_from_db()
        self.assertIsNone(t.completed_at)
        self.assertTrue(
            any(a.after.get("completed_at") for a in m.Audit.objects.filter(entity_id=str(t.id)))
        )

    def test_B01_B02_bug_lifecycle(self):
        bug = s.create_item(
            self.a,
            self.p.id,
            {
                "type": "bug",
                "title": "错误",
                "priority": str(self.priority.id),
                "steps_to_reproduce": "点击",
                "actual_result": "报错",
            },
        )
        for state in ["ready", "active", "review"]:
            self.transition(bug, state)
        self.transition(bug, "ready")
        for state in ["active", "review", "closed"]:
            self.transition(bug, state)
        detail = m.BugDetail.objects.get(item=bug)
        self.assertIsNotNone(detail.submitted_at)
        self.assertEqual(detail.verified_by, self.a)

    def test_I01_iteration_list_summary_counts_and_detail_loading(self):
        from django.test.utils import CaptureQueriesContext

        from .querysets import iteration_rows
        from .serializers import serialize

        today = timezone.localdate()
        iteration = s.iteration_write(
            self.a,
            self.p.id,
            {
                "name": "精简列表",
                "owner": str(self.a.id),
                "start_date": str(today),
                "end_date": str(today + timedelta(days=7)),
            },
        )
        task = self.task(iteration=str(iteration.id))
        for status in ["active", "review", "done"]:
            self.transition(task, status)
        self.task(iteration=str(iteration.id))
        removed = self.task(iteration=str(iteration.id))
        s.update_item(self.a, removed.id, {"version": removed.version}, "delete")
        empty = s.iteration_write(
            self.a,
            self.p.id,
            {
                "name": "空迭代",
                "owner": str(self.a.id),
                "start_date": str(today + timedelta(days=8)),
                "end_date": str(today + timedelta(days=15)),
            },
        )
        with CaptureQueriesContext(connection) as queries:
            rows = [
                serialize(row, iteration_details=False)
                for row in iteration_rows(m.Iteration.objects.filter(project=self.p))
            ]
        self.assertEqual(len(queries), 1)
        by_id = {row["id"]: row for row in rows}
        self.assertEqual(by_id[str(iteration.id)]["item_total"], 2)
        self.assertEqual(by_id[str(iteration.id)]["item_completed"], 1)
        self.assertEqual(by_id[str(empty.id)]["item_total"], 0)
        response = self.request("get", f"projects/{self.p.id}/iterations")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("overdue_items", response.data["items"][0])
        detail = self.request("get", f"iterations/{iteration.id}")
        self.assertEqual(detail.status_code, 200)
        for name in ["items_by_state", "overdue_items", "recent_changes"]:
            self.assertIn(name, detail.data)
        context = self.request("get", f"projects/{self.p.id}/context")
        self.assertNotIn("recent_changes", context.data["iterations"][0])

    def test_I01_I02_finished_iteration(self):
        today = str(timezone.localdate())
        end = str(timezone.localdate() + timedelta(days=7))
        data = {
            "name": "Sprint",
            "owner": str(self.a.id),
            "start_date": today,
            "end_date": end,
        }
        iteration = s.iteration_write(self.a, self.p.id, data)
        with self.assertRaises(DomainError):
            s.iteration_write(self.a, self.p.id, data)
        s.iteration_write(self.a, self.p.id, {**data, "name": "Sprint2", "confirm_overlap": True})
        t = self.task(iteration=str(iteration.id))
        iteration = s.iteration_write(
            self.a, self.p.id, {"version": iteration.version}, iteration.id, "start"
        )
        with self.assertRaises(DomainError):
            s.iteration_write(
                self.a,
                self.p.id,
                {"version": iteration.version},
                iteration.id,
                "finish",
            )
        s.iteration_write(
            self.a,
            self.p.id,
            {"version": iteration.version, "disposition": "keep", "confirm": True},
            iteration.id,
            "finish",
        )
        self.transition(t, "active")
        t.refresh_from_db()
        with self.assertRaises(DomainError):
            s.update_item(self.a, t.id, {"version": t.version, "iteration": None})

    def test_K01_K02_workflow_same_api(self):
        t = self.task()
        self.transition(t, "active")
        board = self.request("get", f"projects/{self.p.id}/board?type=task").data
        self.assertEqual(
            next(c for c in board["columns"] if c["code"] == "active")["items"][0]["status"],
            "active",
        )
        self.assertEqual(
            self.request(
                "post",
                f"work-items/{t.id}/transition",
                {"version": 2, "target_status": "review"},
                self.out,
            ).status_code,
            404,
        )

    def test_A01_A02_empty_readonly_export(self):
        self.assertIsNone(
            self.request("get", f"projects/{self.p.id}/reports/overview").data["completion_rate"]
        )
        member = m.Member.objects.get(project=self.p, user=self.b)
        member.role = "readonly"
        member.save()
        self.assertEqual(
            self.request("get", f"projects/{self.p.id}/reports/export", user=self.b).status_code,
            403,
        )

    def test_D01_D02_document_access(self):
        doc = m.Document.objects.create(
            project=self.p, author=self.b, last_editor=self.b, title="会议", body="记录"
        )
        self.assertEqual(doc.last_editor, self.b)
        self.assertEqual(self.request("get", f"documents/{doc.id}", user=self.out).status_code, 404)

    def test_N01_N02_reminder_dedupe(self):
        t = self.task(due_date=str(timezone.localdate() - timedelta(days=1)))
        s.reminders()
        s.reminders()
        self.assertEqual(m.Notification.objects.filter(item=t, event_type="overdue").count(), 1)
        s.update_item(self.a, t.id, {"version": t.version, "assignee": str(self.a.id)})
        before = m.Notification.objects.filter(recipient=self.b).count()
        s.reminders()
        self.assertEqual(m.Notification.objects.filter(recipient=self.b).count(), before)

    def test_C01_C02_C03_config_references(self):
        t = self.task()
        s.config_write(
            self.admin,
            m.Priority,
            {"version": self.priority.version, "enabled": False},
            self.priority.id,
            pid=self.p.id,
        )
        with self.assertRaises(DomainError):
            self.task(priority=str(self.priority.id))
        t = s.update_item(self.a, t.id, {"version": t.version, "title": "历史优先级允许保留"})
        s.config_write(
            self.admin,
            m.Position,
            {"version": self.pos.version, "enabled": False},
            self.pos.id,
        )
        workflow = defaults()
        next(
            e
            for e in workflow["task"]["transitions"]
            if e["from"] == "review" and e["to"] == "active"
        )["enabled"] = False
        self.p.refresh_from_db()
        s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": workflow})
        self.transition(t, "active")
        self.transition(t, "review")
        with self.assertRaises(DomainError):
            self.transition(t, "active")

    def test_U01_U02_U03_user_and_secret_audit(self):
        user, temp = s.user_write(
            self.admin,
            {
                "username": "new",
                "display_name": "新用户",
                "group": str(self.group.id),
                "position": str(self.pos.id),
            },
        )
        self.assertTrue(user.check_password(temp))
        self.assertTrue(user.must_change_password)
        with self.assertRaises(DomainError):
            s.user_write(self.admin, {"version": self.admin.version}, self.admin.id, "deactivate")
        user, new = s.user_write(self.admin, {"version": user.version}, user.id, "reset-password")
        self.assertNotIn(new, str(list(m.Audit.objects.values())))
        c = APIClient()
        c.force_authenticate(user)
        self.assertEqual(c.get("/api/v1/projects").status_code, 403)

    def test_concurrent_edit_and_number_creation(self):
        t = self.task()
        barrier = threading.Barrier(2)

        def write(i):
            close_old_connections()
            u = m.User.objects.get(pk=self.a.id)
            barrier.wait()
            try:
                s.update_item(u, t.id, {"version": t.version, "title": f"并发{i}"})
                return "ok"
            except DomainError as e:
                return e.status
            finally:
                connection.close()

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(write, [1, 2]))
        self.assertCountEqual(results, ["ok", 409])

        def create(i):
            close_old_connections()
            try:
                return s.create_item(
                    m.User.objects.get(pk=self.a.id),
                    self.p.id,
                    {"type": "task", "title": f"任务{i}"},
                ).number
            finally:
                connection.close()

        with ThreadPoolExecutor(4) as pool:
            numbers = list(pool.map(create, range(8)))
        self.assertEqual(len(set(numbers)), 8)

    def test_attachment_private_permission_and_size(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        t = self.task()
        c = APIClient()
        c.force_authenticate(self.a)
        formats = self.request("get", "auth/me", user=self.a).data["attachment_extensions"]
        self.assertTrue(
            {
                ".ppt",
                ".pptx",
                ".zip",
                ".7z",
                ".tiff",
                ".mp4",
                ".mp3",
                ".webm",
                ".xmind",
                ".drawio",
            }.issubset(set(formats))
        )
        response = c.post(
            f"/api/v1/work-items/{t.id}/attachments",
            {"file": SimpleUploadedFile("notes.txt", b"private")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        aid = response.data["id"]
        self.assertNotIn("file", response.data)
        self.assertEqual(self.request("get", "attachments/" + aid, user=self.out).status_code, 404)
        for filename in [
            "slides.ppt",
            "bundle.7z",
            "diagram.drawio",
            "screenshot.tiff",
            "clip.mp4",
            "audio.mp3",
        ]:
            response = c.post(
                f"/api/v1/work-items/{t.id}/attachments",
                {"file": SimpleUploadedFile(filename, b"test file bytes")},
                format="multipart",
            )
            self.assertEqual(response.status_code, 201, (filename, response.data))
        response = c.post(
            f"/api/v1/work-items/{t.id}/attachments",
            {"file": SimpleUploadedFile("danger.html", b"<script/>")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 422)

    def test_csrf_and_safe_methods(self):
        c = APIClient(enforce_csrf_checks=True)
        self.assertEqual(
            c.post(
                "/api/v1/auth/login",
                {"username": "alice", "password": TEST_PASSWORD},
            ).status_code,
            403,
        )
        self.assertEqual(self.request("get", f"projects/{self.p.id}/close").status_code, 405)

    def test_cross_project_relations_and_invalid_dates_rollback(self):
        second = s.create_project(self.out, {"code": "ISOLATE", "name": "隔离项目"})
        req = s.create_item(
            self.out,
            second.id,
            {
                "type": "requirement",
                "title": "私有需求",
                "description": "不能跨项目",
                "priority": str(s.default_priority(second)),
            },
        )
        before = m.WorkItem.objects.count()
        with self.assertRaises(DomainError):
            self.task(requirement=str(req.id))
        self.assertEqual(m.WorkItem.objects.count(), before)
        with self.assertRaises(DomainError):
            self.task(planned_start_date="2026-10-20", due_date="2026-10-19")
        self.assertEqual(m.WorkItem.objects.count(), before)
        t = self.task()
        self.assertEqual(t.number, "TEST-T-1")
        self.assertEqual(t.priority, self.priority)

    def test_notification_failure_persists_outbox_and_retries(self):
        from unittest.mock import patch

        with patch(
            "core.models.Notification.objects.get_or_create",
            side_effect=RuntimeError("temporary failure"),
        ):
            t = self.task()
        self.assertTrue(m.WorkItem.objects.filter(pk=t.pk).exists())
        self.assertTrue(m.NotificationEvent.objects.filter(item=t, delivered_at=None).exists())
        s.reminders()
        self.assertEqual(
            m.Notification.objects.filter(
                item=t, event_type="assignment", recipient=self.b
            ).count(),
            1,
        )
        self.assertFalse(m.NotificationEvent.objects.filter(item=t, delivered_at=None).exists())

    def test_real_sessions_reset_deactivate_reenable(self):
        c = APIClient()
        self.assertTrue(c.login(username=self.b.username, password=TEST_PASSWORD))
        self.assertEqual(c.get("/api/v1/projects").status_code, 200)
        user, temp = s.user_write(
            self.admin, {"version": self.b.version}, self.b.id, "reset-password"
        )
        self.assertEqual(c.get("/api/v1/projects").status_code, 401)
        self.assertTrue(c.login(username=user.username, password=temp))
        self.assertEqual(c.get("/api/v1/projects").data["code"], "PASSWORD_CHANGE_REQUIRED")
        response = c.post(
            "/api/v1/auth/change-password",
            {"password": NEW_TEST_PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        user, _ = s.user_write(self.admin, {"version": user.version}, user.id, "deactivate")
        s.user_write(self.admin, {"version": user.version}, user.id, "activate")
        self.assertEqual(c.get("/api/v1/projects").status_code, 401)

    def test_UI64_password_change_requires_old_only_for_normal_changes(self):
        self.b.must_change_password = True
        self.b.save()
        with self.assertRaises(DomainError):
            s.change_password(self.b, {"password": TEST_PASSWORD})
        changed = s.change_password(self.b, {"password": NEW_TEST_PASSWORD})
        self.assertFalse(changed.must_change_password)
        with self.assertRaises(DomainError):
            s.change_password(changed, {"password": ANOTHER_TEST_PASSWORD})
        with self.assertRaises(DomainError):
            s.change_password(
                changed, {"old_password": WRONG_TEST_PASSWORD, "password": ANOTHER_TEST_PASSWORD}
            )
        changed = s.change_password(
            changed, {"old_password": NEW_TEST_PASSWORD, "password": ANOTHER_TEST_PASSWORD}
        )
        self.assertTrue(changed.check_password(ANOTHER_TEST_PASSWORD))

    def test_protected_admins_concurrent_deactivation(self):
        second = self.user("admin-two", True)
        barrier = threading.Barrier(2)

        def disable(uid):
            close_old_connections()
            actor = m.User.objects.get(pk=self.admin.id)
            barrier.wait()
            try:
                s.user_write(actor, {"version": 1}, uid, "deactivate")
                return "ok"
            except DomainError:
                return "rejected"
            finally:
                connection.close()

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(disable, [self.admin.id, second.id]))
        self.assertCountEqual(results, ["rejected", "rejected"])
        self.assertEqual(m.User.objects.filter(is_superuser=True, is_active=True).count(), 2)

    def test_document_attachment_revoked_after_removal_and_delete(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        doc = m.Document.objects.create(
            project=self.p, author=self.a, last_editor=self.a, title="安全文档", body="资料"
        )
        c = APIClient()
        c.force_authenticate(self.a)
        response = c.post(
            f"/api/v1/documents/{doc.id}/attachments",
            {"file": SimpleUploadedFile("doc.txt", b"private document")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)
        aid = response.data["id"]
        member = m.Member.objects.get(project=self.p, user=self.b)
        s.member_write(self.a, self.p.id, {"version": member.version}, self.b.id, True)
        self.assertEqual(self.request("get", "attachments/" + aid, user=self.b).status_code, 404)
        s.document_write(self.a, self.p.id, {"version": doc.version}, doc.id, True)
        self.assertEqual(self.request("get", "attachments/" + aid).status_code, 404)

    def test_workflow_unreachable_rejected_and_no_mutation(self):
        workflow = defaults()
        for edge in workflow["task"]["transitions"]:
            if edge["to"] == "done":
                edge["enabled"] = False
        self.p.refresh_from_db()
        with self.assertRaises(DomainError):
            s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": workflow})
        self.p.refresh_from_db()
        self.assertEqual(self.p.workflow, defaults())

    def test_H01_due_order_and_closed_project(self):
        undated = self.task()
        overdue = self.task(due_date=str(timezone.localdate() - timedelta(days=1)))
        data = self.request("get", "me/todos", user=self.b).data
        self.assertEqual([r["id"] for r in data["items"]], [str(overdue.id), str(undated.id)])
        self.p.refresh_from_db()
        s.update_project(self.a, self.p.id, {"version": self.p.version}, "close")
        self.assertEqual(self.request("get", "me/todos", user=self.b).data["total"], 0)

    def test_report_completion_date_independent_of_creation(self):
        t = self.task()
        m.WorkItem.objects.filter(pk=t.pk).update(created_at=timezone.now() - timedelta(days=30))
        for state in ["active", "review", "done"]:
            self.transition(t, state)
        today = str(timezone.localdate())
        response = self.request(
            "get", f"projects/{self.p.id}/reports/overview?date_from={today}&date_to={today}"
        )
        self.assertEqual(response.data["total"], 0)
        self.assertEqual(response.data["members"][0]["completed"], 1)

    def test_comment_mentions_audit_and_author_permissions(self):
        t = self.task()
        comment = s.comment_write(self.a, t.id, {"body": "请协助确认", "mentions": [self.b.id]})
        self.assertEqual(
            m.Notification.objects.filter(item=t, recipient=self.b, event_type="mention").count(), 1
        )
        with self.assertRaises(DomainError):
            s.comment_write(
                self.b, t.id, {"version": comment.version, "body": "覆盖他人评论"}, comment.id
            )
        response = self.request("get", f"work-items/{t.id}/history")
        self.assertTrue(any(row["entity_type"] == "Comment" for row in response.data["items"]))
        with self.assertRaises(DomainError):
            s.comment_write(self.a, t.id, {"body": "跨项目提及", "mentions": [self.out.id]})

    def test_disabled_position_preserved_on_existing_profile(self):
        s.config_write(
            self.admin, m.Position, {"version": self.pos.version, "enabled": False}, self.pos.id
        )
        obj, _ = s.user_write(
            self.admin,
            {
                "version": self.b.version,
                "display_name": "新姓名",
                "position": str(self.pos.id),
                "group": str(self.group.id),
            },
            self.b.id,
        )
        self.assertEqual(obj.display_name, "新姓名")
        with self.assertRaises(DomainError):
            s.user_write(
                self.admin,
                {
                    "username": "disabled-position-new",
                    "display_name": "用户",
                    "position": str(self.pos.id),
                    "group": str(self.group.id),
                },
            )

    def test_config_drag_order_persists_and_new_records_append(self):
        for model, path in [(m.Position, "positions"), (m.Priority, "priorities")]:
            first = s.config_write(self.admin, model, {"name": path + "-first"})
            second = s.config_write(self.admin, model, {"name": path + "-second"})
            response = self.request(
                "post",
                path + "/reorder",
                {
                    "item_id": str(second.id),
                    "version": second.version,
                    "target_id": str(first.id),
                    "target_version": first.version,
                    "placement": "before",
                },
                self.admin,
            )
            self.assertEqual(response.status_code, 200, response.data)
            listing = self.request("get", path, user=self.admin).data["items"]
            ids = [row["id"] for row in listing]
            self.assertLess(ids.index(str(second.id)), ids.index(str(first.id)))
            created = s.config_write(self.admin, model, {"name": path + "-last"})
            self.assertEqual(
                self.request("get", path, user=self.admin).data["items"][-1]["id"], str(created.id)
            )
            second.refresh_from_db()
            order = second.sort_order
            s.config_write(
                self.admin, model, {"version": second.version, "name": path + "-renamed"}, second.id
            )
            second.refresh_from_db()
            self.assertEqual(second.sort_order, order)

    def test_config_reorder_conflict_permission_and_invalid_target(self):
        data = {
            "item_id": str(self.template_priority.id),
            "version": self.template_priority.version,
            "target_id": str(self.template_high.id),
            "target_version": self.template_high.version,
            "placement": "before",
        }
        self.assertEqual(self.request("post", "priorities/reorder", data, self.a).status_code, 403)
        self.assertEqual(
            self.request("post", "priorities/reorder", data, self.admin).status_code, 200
        )
        before = list(m.Priority.objects.order_by("id").values_list("id", "version", "sort_order"))
        audit_count = m.Audit.objects.count()
        self.assertEqual(
            self.request("post", "priorities/reorder", data, self.admin).status_code, 409
        )
        self.assertEqual(
            before,
            list(m.Priority.objects.order_by("id").values_list("id", "version", "sort_order")),
        )
        self.assertEqual(audit_count, m.Audit.objects.count())
        self.template_priority.refresh_from_db()
        data["version"] = self.template_priority.version
        data["target_id"] = str(self.pos.id)
        self.assertEqual(
            self.request("post", "priorities/reorder", data, self.admin).status_code, 409
        )
        self.assertEqual(
            self.request(
                "post",
                "priorities/reorder",
                {"item_id": str(self.template_priority.id)},
                self.admin,
            ).status_code,
            422,
        )
        self.assertEqual(
            self.request("get", "priorities/reorder", user=self.admin).status_code, 405
        )

    def test_reorder_failure_rolls_back_order_versions_and_audit(self):
        from unittest.mock import patch

        before = list(m.Priority.objects.order_by("id").values_list("id", "version", "sort_order"))
        with patch("core.services.audit", side_effect=RuntimeError("audit failure")):
            with self.assertRaises(RuntimeError):
                s.reorder_config(
                    self.admin,
                    m.Priority,
                    {
                        "item_id": self.template_priority.id,
                        "version": self.template_priority.version,
                        "target_id": self.template_high.id,
                        "target_version": self.template_high.version,
                        "placement": "before",
                    },
                )
        self.assertEqual(
            before,
            list(m.Priority.objects.order_by("id").values_list("id", "version", "sort_order")),
        )

    def test_priority_drag_order_used_by_board_and_requirement_pool(self):
        low = s.create_item(
            self.a,
            self.p.id,
            {
                "type": "requirement",
                "title": "中优先",
                "description": "描述",
                "priority": str(self.priority.id),
            },
        )
        high = s.create_item(
            self.a,
            self.p.id,
            {
                "type": "requirement",
                "title": "高优先",
                "description": "描述",
                "priority": str(self.high.id),
            },
        )
        s.reorder_config(
            self.admin,
            m.Priority,
            {
                "item_id": self.priority.id,
                "version": self.priority.version,
                "target_id": self.high.id,
                "target_version": self.high.version,
                "placement": "before",
            },
            pid=self.p.id,
        )
        result = self.request("get", f"projects/{self.p.id}/work-items?type=requirement").data[
            "items"
        ]
        self.assertEqual([row["id"] for row in result], [str(low.id), str(high.id)])
        board = self.request("get", f"projects/{self.p.id}/board?type=requirement").data
        self.assertEqual(
            [row["id"] for row in board["columns"][0]["items"]], [str(low.id), str(high.id)]
        )
        self.assertEqual(
            self.request(
                "patch",
                f"priorities/{self.priority.id}",
                {"version": 2, "sort_order": 99},
                self.admin,
            ).status_code,
            422,
        )

    def test_category_drag_is_project_scoped_and_admin_only(self):
        first = s.config_write(self.a, m.Category, {"name": "分类甲"}, pid=self.p.id)
        second = s.config_write(self.a, m.Category, {"name": "分类乙"}, pid=self.p.id)
        path = f"projects/{self.p.id}/categories"
        data = {
            "item_id": str(second.id),
            "version": second.version,
            "target_id": str(first.id),
            "target_version": first.version,
            "placement": "before",
        }
        self.assertEqual(self.request("post", path + "/reorder", data, self.b).status_code, 403)
        self.assertEqual(self.request("post", path + "/reorder", data, self.a).status_code, 200)
        self.assertEqual(
            [row["id"] for row in self.request("get", path).data["items"]],
            [str(second.id), str(first.id)],
        )
        self.assertEqual(self.request("post", path + "/reorder", data, self.a).status_code, 409)
        other = s.create_project(self.out, {"name": "隔离项目", "code": "CAT-OTHER"})
        foreign = s.config_write(self.out, m.Category, {"name": "隔离分类"}, pid=other.id)
        second.refresh_from_db()
        data.update(
            version=second.version, target_id=str(foreign.id), target_version=foreign.version
        )
        self.assertEqual(self.request("post", path + "/reorder", data, self.a).status_code, 409)
        self.assertEqual(
            self.request("post", path, {"name": "手工排序", "sort_order": 7}).status_code, 422
        )
        self.p.refresh_from_db()
        s.update_project(self.a, self.p.id, {"version": self.p.version}, "close")
        data.update(
            target_id=str(first.id), target_version=m.Category.objects.get(pk=first.id).version
        )
        self.assertEqual(self.request("post", path + "/reorder", data, self.a).status_code, 422)

    def test_priority_color_and_workflow_order_persist_without_state_changes(self):
        response = self.request(
            "patch",
            f"projects/{self.p.id}/dictionaries/{self.priority.id}",
            {"version": self.priority.version, "color": "purple"},
            self.admin,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["color"], "purple")
        t = self.task()
        self.assertEqual(self.request("get", f"work-items/{t.id}").data["priority_color"], "purple")
        self.assertEqual(
            self.request(
                "patch",
                f"projects/{self.p.id}/dictionaries/{self.priority.id}",
                {"version": response.data["version"], "color": "invalid"},
                self.admin,
            ).status_code,
            422,
        )
        spec = defaults()
        states = spec["task"]["states"]
        states[0]["order"], states[1]["order"] = states[1]["order"], states[0]["order"]
        self.p.refresh_from_db()
        s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": spec})
        board = self.request("get", f"projects/{self.p.id}/board?type=task").data
        self.assertEqual(board["columns"][0]["code"], "active")
        t.refresh_from_db()
        self.assertEqual(t.status, "ready")
        self.assertEqual(
            self.request(
                "patch", "auth/profile", {"version": self.a.version, "display_name": "不再支持"}
            ).status_code,
            404,
        )

    def test_UI05_multipart_record_images_attachments_and_private_inline(self):
        import json
        from tempfile import TemporaryDirectory

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        token = "reqflow-upload:11111111-1111-4111-8111-111111111111"
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            client = APIClient()
            client.force_authenticate(self.a)
            response = client.post(
                f"/api/v1/projects/{self.p.id}/work-items",
                {
                    "payload": json.dumps(
                        {
                            "type": "task",
                            "title": "粘贴图片",
                            "description": f"**说明**\n\n![截图]({token})",
                            "upload_tokens": [token],
                        }
                    ),
                    "files": [
                        SimpleUploadedFile(
                            "截图.png", b"\x89PNG\r\n\x1a\n", content_type="image/png"
                        )
                    ],
                },
                format="multipart",
            )
            self.assertEqual(response.status_code, 201, response.data)
            item = m.WorkItem.objects.get(pk=response.data["id"])
            attachment = m.Attachment.objects.get(item=item)
            self.assertIn(f"/api/v1/attachments/{attachment.id}?inline=1", item.description)
            self.assertNotIn("reqflow-upload:", item.description)
            inline = client.get(f"/api/v1/attachments/{attachment.id}?inline=1")
            self.assertEqual(inline.status_code, 200)
            self.assertTrue(inline["Content-Disposition"].startswith("inline"))
            self.assertEqual(inline["Content-Type"], "image/png")
            inline.close()
            comment_image = s.attachment_upload(
                self.a,
                item,
                SimpleUploadedFile("comment.png", b"\x89PNG\r\n\x1a\n", content_type="image/png"),
            )
            m.Comment.objects.create(
                item=item,
                author=self.a,
                body=f"![评论截图](/api/v1/attachments/{comment_image.id}?inline=1)",
            )
            uploaded = client.post(
                f"/api/v1/work-items/{item.id}/attachments",
                {"file": SimpleUploadedFile("manual.pdf", b"uploaded")},
                format="multipart",
            )
            self.assertEqual(uploaded.status_code, 201, uploaded.data)
            listed = client.get(f"/api/v1/work-items/{item.id}/attachments")
            self.assertEqual([row["id"] for row in listed.data["items"]], [uploaded.data["id"]])

            # Editing an existing description uses PATCH + multipart. Pasted
            # images must remain inline-only after the edit is saved as well.
            edit_token = "reqflow-upload:22222222-2222-4222-8222-222222222222"
            second_edit_token = "reqflow-upload:33333333-3333-4333-8333-333333333333"
            item.refresh_from_db()
            edited = client.patch(
                f"/api/v1/work-items/{item.id}",
                {
                    "payload": json.dumps(
                        {
                            "version": item.version,
                            "title": item.title,
                            "description": (
                                f"更新说明\n\n![新截图]({edit_token})\n\n"
                                f"![第二张截图]({second_edit_token})"
                            ),
                            "upload_tokens": [edit_token, second_edit_token],
                        }
                    ),
                    "files": [
                        SimpleUploadedFile(
                            "新截图.png", b"\x89PNG\r\n\x1a\n", content_type="image/png"
                        ),
                        SimpleUploadedFile(
                            "第二张截图.png",
                            b"\x89PNG\r\n\x1a\n",
                            content_type="image/png",
                        ),
                    ],
                },
                format="multipart",
            )
            self.assertEqual(edited.status_code, 200, edited.data)
            item.refresh_from_db()
            edited_inline = m.Attachment.objects.get(item=item, original_name="新截图.png")
            second_edited_inline = m.Attachment.objects.get(
                item=item, original_name="第二张截图.png"
            )
            self.assertTrue(edited_inline.is_inline_image)
            self.assertTrue(second_edited_inline.is_inline_image)
            self.assertIn(f"/api/v1/attachments/{edited_inline.id}?inline=1", item.description)
            self.assertIn(
                f"/api/v1/attachments/{second_edited_inline.id}?inline=1", item.description
            )
            listed = client.get(f"/api/v1/work-items/{item.id}/attachments")
            self.assertEqual([row["id"] for row in listed.data["items"]], [uploaded.data["id"]])
            self.assertEqual(
                self.request(
                    "get", f"attachments/{attachment.id}?inline=1", user=self.out
                ).status_code,
                404,
            )
            legacy = m.Document.objects.create(
                project=self.p, author=self.a, last_editor=self.a, title="可视化文档", body="# 正文"
            )
            document = client.patch(
                f"/api/v1/documents/{legacy.id}",
                {
                    "payload": json.dumps(
                        {
                            "version": legacy.version,
                            "title": "可视化文档",
                            "body": "# 正文",
                            "upload_tokens": [token],
                        }
                    ),
                    "files": [SimpleUploadedFile("附件.txt", b"content")],
                },
                format="multipart",
            )
            self.assertEqual(document.status_code, 200, document.data)
            self.assertEqual(
                m.Attachment.objects.filter(document_id=document.data["id"]).count(), 1
            )

    def test_UI05_failed_upload_rolls_back_record_files_and_stale_edits(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        token = "reqflow-upload:11111111-1111-4111-8111-111111111111"
        other = "reqflow-upload:22222222-2222-4222-8222-222222222222"
        with TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            client = APIClient()
            client.force_authenticate(self.a)
            count = m.WorkItem.objects.count()
            result = client.post(
                f"/api/v1/projects/{self.p.id}/work-items",
                {
                    "payload": json.dumps(
                        {"type": "task", "title": "回滚", "upload_tokens": [token, other]}
                    ),
                    "files": [
                        SimpleUploadedFile("good.txt", b"ok"),
                        SimpleUploadedFile("bad.exe", b"invalid"),
                    ],
                },
                format="multipart",
            )
            self.assertEqual(result.status_code, 422)
            self.assertEqual(m.WorkItem.objects.count(), count)
            self.assertFalse(m.Attachment.objects.exists())
            self.assertEqual([p for p in Path(media).rglob("*") if p.is_file()], [])
            item = self.task()
            stale = client.patch(
                f"/api/v1/work-items/{item.id}",
                {
                    "payload": json.dumps(
                        {"version": item.version + 1, "title": "过期编辑", "upload_tokens": [token]}
                    ),
                    "files": [SimpleUploadedFile("good.txt", b"ok")],
                },
                format="multipart",
            )
            self.assertEqual(stale.status_code, 409)
            item.refresh_from_db()
            self.assertEqual(item.title, "实现功能")
            self.assertFalse(m.Attachment.objects.exists())
            missing = self.request(
                "post",
                f"projects/{self.p.id}/work-items",
                {"type": "task", "title": "缺图片", "description": f"![图片]({token})"},
            )
            self.assertEqual(missing.status_code, 422)

    def test_UI10_optional_description_and_default_priority_all_types(self):
        for kind, fields in [
            ("requirement", {}),
            ("task", {}),
            ("bug", {"steps_to_reproduce": "复现", "actual_result": "实际"}),
        ]:
            result = self.request(
                "post",
                f"projects/{self.p.id}/work-items",
                {"type": kind, "title": "只填必要字段", **fields},
            )
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(str(result.data["priority"]), str(self.priority.id))
            self.assertEqual(result.data["description"], "")
        item = self.task()
        cleared = self.request(
            "patch",
            f"work-items/{item.id}",
            {"version": item.version, "priority": None, "description": ""},
        )
        self.assertEqual(cleared.status_code, 200, cleared.data)
        self.assertEqual(str(cleared.data["priority"]), str(self.priority.id))
        rejected = self.request(
            "post", f"projects/{self.p.id}/work-items", {"type": "requirement", "title": ""}
        )
        self.assertEqual(rejected.status_code, 422)

    def test_UI10_transition_assignee_comment_atomic_and_permissions(self):
        item = self.task()
        path = f"work-items/{item.id}/transition"
        payload = {
            "version": item.version,
            "target_status": "active",
            "assignee": str(self.a.id),
            "body": "开始处理",
            "mentions": [str(self.out.id)],
        }
        failed = self.request("post", path, payload)
        self.assertEqual(failed.status_code, 422, failed.data)
        item.refresh_from_db()
        self.assertEqual(item.status, "ready")
        self.assertEqual(item.assignee_id, self.b.id)
        self.assertFalse(m.Comment.objects.filter(item=item).exists())
        payload["mentions"] = [str(self.b.id)]
        success = self.request("post", path, payload)
        self.assertEqual(success.status_code, 200, success.data)
        item.refresh_from_db()
        self.assertEqual(item.status, "active")
        self.assertEqual(item.assignee_id, self.a.id)
        self.assertEqual(m.Comment.objects.get(item=item).body, "开始处理")
        self.assertEqual(self.request("post", path, payload).status_code, 409)
        self.assertEqual(
            self.request(
                "post",
                path,
                {**payload, "version": item.version, "target_status": "review"},
                self.out,
            ).status_code,
            404,
        )

    def test_UI17_multiple_handlers_permissions_notifications_handover(self):
        item = self.task()
        payload = {
            "version": item.version,
            "target_status": "active",
            "handlers": [str(self.a.id), str(self.b.id)],
        }
        path = f"work-items/{item.id}/transition"
        for ids in [[], [str(self.out.id)], [str(self.b.id), str(self.b.id)]]:
            response = self.request("post", path, {**payload, "handlers": ids})
            self.assertEqual(response.status_code, 422, response.data)
            item.refresh_from_db()
            self.assertEqual(item.status, "ready")
            self.assertEqual(list(item.handlers.all()), [self.b])
        response = self.request("post", path, payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertCountEqual(response.data["handlers"], [str(self.a.id), str(self.b.id)])
        self.assertEqual(self.request("post", path, payload).status_code, 409)
        self.assertEqual(self.request("get", "me/todos", user=self.b).data["total"], 1)
        item.refresh_from_db()
        # The second handler can edit an item created by someone else.
        self.assertEqual(
            self.request(
                "patch",
                f"work-items/{item.id}",
                {"version": item.version, "description": "协作处理"},
                self.b,
            ).status_code,
            200,
        )
        report = self.request("get", f"projects/{self.p.id}/reports/overview").data
        self.assertEqual(report["total"], 1)
        self.assertEqual({entry["name"] for entry in report["members"]}, {"alice", "bob"})
        self.assertTrue(
            m.Notification.objects.filter(item=item, recipient=self.b, event_type="status").exists()
        )
        member = m.Member.objects.get(project=self.p, user=self.b)
        s.member_write(
            self.a,
            self.p.id,
            {"version": member.version, "unfinished_items": {"action": "unassign"}},
            self.b.id,
            delete=True,
        )
        item.refresh_from_db()
        self.assertEqual(list(item.handlers.all()), [self.a])
        self.assertEqual(item.assignee, self.a)

    def test_UI16_comment_snapshot_images_edit_permissions_and_rollback(self):
        import json
        import tempfile
        from uuid import uuid4

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        item = self.task()
        token = "reqflow-upload:" + str(uuid4())
        second_token = "reqflow-upload:" + str(uuid4())
        path = f"/api/v1/work-items/{item.id}/comments"
        with tempfile.TemporaryDirectory() as root, override_settings(MEDIA_ROOT=root):
            result = self.client.post(
                path,
                {
                    "payload": json.dumps(
                        {
                            "body": (
                                f"**评审**\n\n![截图]({token})\n\n![第二张截图]({second_token})"
                            ),
                            "upload_tokens": [token, second_token],
                        }
                    ),
                    "files": [
                        SimpleUploadedFile("shot.png", b"\x89PNG\r\n\x1a\nimage", "image/png"),
                        SimpleUploadedFile("shot-2.png", b"\x89PNG\r\n\x1a\nimage", "image/png"),
                    ],
                },
                format="multipart",
            )
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(result.data["workflow_status"], "ready")
            self.assertEqual(result.data["author_name"], "alice")
            self.assertIn("/api/v1/attachments/", result.data["body"])
            comment = m.Comment.objects.get(pk=result.data["id"])
            inline_comment_images = m.Attachment.objects.filter(item=item, is_inline_image=True)
            self.assertEqual(inline_comment_images.count(), 2)
            self.assertEqual(
                self.request("get", f"work-items/{item.id}/attachments").data["total"], 0
            )
            repeated = self.request(
                "post",
                f"work-items/{item.id}/comments",
                {"body": "同一工作项的第二条评论"},
            )
            self.assertEqual(repeated.status_code, 201, repeated.data)
            self.transition(item, "active")
            updated = self.request(
                "patch",
                f"comments/{comment.id}",
                {"version": comment.version, "body": "### 修订\n\n内容"},
            )
            self.assertEqual(updated.status_code, 200, updated.data)
            self.assertEqual(updated.data["workflow_status"], "ready")
            self.assertEqual(
                self.request(
                    "patch",
                    f"comments/{comment.id}",
                    {"version": updated.data["version"], "body": "篡改"},
                    self.b,
                ).status_code,
                403,
            )
            self.assertEqual(
                self.request("post", f"work-items/{item.id}/comments", {"body": "  "}).status_code,
                422,
            )
            count = m.Comment.objects.filter(item=item).count()
            item.refresh_from_db()
            bad = self.client.post(
                f"/api/v1/work-items/{item.id}/transition",
                {
                    "payload": json.dumps(
                        {
                            "version": item.version,
                            "target_status": "review",
                            "handlers": [str(self.a.id), str(self.b.id)],
                            "body": f"![图]({token})",
                            "upload_tokens": [token],
                        }
                    ),
                    "files": [SimpleUploadedFile("bad.exe", b"bad")],
                },
                format="multipart",
            )
            self.assertEqual(bad.status_code, 422, bad.data)
            item.refresh_from_db()
            self.assertEqual(item.status, "active")
            self.assertEqual(m.Comment.objects.filter(item=item).count(), count)
            self.assertEqual(list(item.handlers.all()), [self.b])

    def test_UI16_comment_snapshot_after_waiting_for_transition_lock(self):
        from unittest.mock import patch

        from django.db import transaction

        item = self.task()
        reached = threading.Event()
        original = m.Project.objects.select_for_update

        def lock_query(*args, **kwargs):
            reached.set()
            return original(*args, **kwargs)

        def write_comment():
            close_old_connections()
            try:
                return s.comment_write(self.a, item.id, {"body": "并发评论"}).workflow_status
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                m.Project.objects.select_for_update().get(pk=self.p.pk)
                with patch.object(m.Project.objects, "select_for_update", side_effect=lock_query):
                    future = pool.submit(write_comment)
                    self.assertTrue(reached.wait(5))
                    item.status = "active"
                    item.save(update_fields=["status"])
            self.assertEqual(future.result(timeout=5), "active")

    def test_UI19_comment_order_uses_creation_not_edit_time(self):
        item = self.task()
        first = s.comment_write(self.a, item.id, {"body": "旧评论"})
        second = s.comment_write(self.a, item.id, {"body": "新评论"})
        m.Comment.objects.filter(pk=first.pk).update(created_at=timezone.now() - timedelta(days=1))
        s.comment_write(self.a, item.id, {"version": first.version, "body": "编辑旧评论"}, first.id)
        result = self.request("get", f"work-items/{item.id}/comments?sort=updated_at")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(
            [entry["id"] for entry in result.data["items"]], [str(second.id), str(first.id)]
        )

    def test_D03_import_text_private_preview_and_download(self):
        import tempfile

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        from .document_files import import_document

        with tempfile.TemporaryDirectory() as storage, override_settings(MEDIA_ROOT=storage):
            payload = "中文文档\n<script>仅文本</script>".encode("gb18030")
            obj = import_document(self.a, self.p.id, SimpleUploadedFile("会议.txt", payload))
            self.assertEqual(obj.document_type, "txt")
            self.assertEqual(obj.size_bytes, len(payload))
            detail = self.request("get", f"documents/{obj.id}")
            self.assertNotIn("source_file", detail.data)
            self.assertNotIn("preview_file", detail.data)
            preview = self.request("get", f"documents/{obj.id}/preview")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(b"".join(preview.streaming_content), payload)
            preview.close()
            self.assertTrue(preview["Content-Type"].startswith("text/plain"))
            download = self.request("get", f"documents/{obj.id}/download")
            self.assertEqual(b"".join(download.streaming_content), payload)
            self.assertIn("attachment", download["Content-Disposition"])
            download.close()
            for suffix in ["", "/preview", "/download"]:
                self.assertEqual(
                    self.request("get", f"documents/{obj.id}{suffix}", user=self.out).status_code,
                    404,
                )
            self.add(self.out, "readonly")
            self.assertEqual(
                self.request("get", f"documents/{obj.id}/preview", user=self.out).status_code, 200
            )
            m.Member.objects.filter(project=self.p, user=self.out).update(deleted_at=timezone.now())
            self.assertEqual(
                self.request("get", f"documents/{obj.id}/preview", user=self.out).status_code, 404
            )
            with self.assertRaises(DomainError):
                s.document_write(
                    self.a, self.p.id, {"version": obj.version, "body": "改变"}, obj.id
                )
            self.assertEqual(
                m.Audit.objects.filter(entity_id=str(obj.id), action="create").count(), 1
            )
            s.document_write(self.a, self.p.id, {"version": obj.version}, obj.id, delete=True)
            self.assertEqual(self.request("get", f"documents/{obj.id}/download").status_code, 404)

    def test_D03_import_size_formats_permission_and_closed_project(self):
        import tempfile

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        from .document_files import import_document

        with (
            tempfile.TemporaryDirectory() as storage,
            override_settings(MEDIA_ROOT=storage, DOCUMENT_MAX_BYTES=8),
        ):
            for name, data in [
                ("empty.txt", b""),
                ("large.txt", b"123456789"),
                ("wrong.exe", b"hi"),
                ("wrong.docx", b"notzip"),
                ("wrong.pdf", b"notpdf"),
                ("wrong.txt", b"\x00\x01"),
            ]:
                with self.assertRaises(DomainError):
                    import_document(self.a, self.p.id, SimpleUploadedFile(name, data))
            with self.assertRaises(DomainError):
                import_document(self.out, self.p.id, SimpleUploadedFile("ok.txt", b"ok"))
            self.add(self.out, "readonly")
            with self.assertRaises(DomainError):
                import_document(self.out, self.p.id, SimpleUploadedFile("ok.txt", b"ok"))
            self.p.status = "closed"
            self.p.save()
            with self.assertRaises(DomainError):
                import_document(self.a, self.p.id, SimpleUploadedFile("ok.txt", b"ok"))
            self.assertEqual(m.Document.objects.count(), 0)

    def test_D03_originals_without_conversion_and_storage_rollback(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        from django.conf import settings
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        from .document_files import import_document

        with tempfile.TemporaryDirectory() as storage, override_settings(MEDIA_ROOT=storage):
            fixtures = settings.BASE_DIR.parent / "frontend/e2e/fixtures/import-documents"
            with patch(
                "subprocess.run",
                side_effect=AssertionError("Import must not run external processes"),
            ):
                for kind in [
                    "docx",
                    "xlsx",
                    "pptx",
                    "doc",
                    "xls",
                    "ppt",
                    "pdf",
                    "csv",
                ]:
                    payload = (fixtures / f"sample.{kind}").read_bytes()
                    obj = import_document(
                        self.a, self.p.id, SimpleUploadedFile(f"sample.{kind}", payload)
                    )
                    self.assertFalse(obj.preview_file)
                    # Historical PDF references must never be read by the new endpoint.
                    obj.preview_file = "obsolete-preview-does-not-exist.pdf"
                    obj.save()
                    response = self.request("get", f"documents/{obj.id}/preview")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(b"".join(response.streaming_content), payload)
                    response.close()
            count = m.Document.objects.count()
            files = {p for p in Path(storage).rglob("*") if p.is_file()}
            with patch(
                "core.document_files.audit", side_effect=RuntimeError("injected audit failure")
            ):
                with self.assertRaises(RuntimeError):
                    import_document(self.a, self.p.id, SimpleUploadedFile("sample.txt", b"hi"))
            self.assertEqual(m.Document.objects.count(), count)
            self.assertEqual({p for p in Path(storage).rglob("*") if p.is_file()}, files)

    def test_D03_import_api_multipart_and_markdown_rules(self):
        import tempfile

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        with tempfile.TemporaryDirectory() as storage, override_settings(MEDIA_ROOT=storage):
            result = self.client.post(
                f"/api/v1/projects/{self.p.id}/documents/import",
                {"file": SimpleUploadedFile("sample.txt", b"hello")},
                format="multipart",
            )
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(result.data["document_type"], "txt")
            attachment = self.client.post(
                f"/api/v1/documents/{result.data['id']}/attachments",
                {"file": SimpleUploadedFile("extra.txt", b"no")},
                format="multipart",
            )
            self.assertEqual(attachment.status_code, 422)

            self.assertEqual(
                self.request("get", f"projects/{self.p.id}/documents/import").status_code, 405
            )
            self.assertEqual(
                self.request("post", f"documents/{result.data['id']}/download").status_code, 405
            )
            with self.assertRaises(DomainError):
                s.document_write(self.a, self.p.id, {"title": "空正文", "body": " "})
            markdown = m.Document.objects.create(
                project=self.p, author=self.a, last_editor=self.a, title="说明", body="# Markdown"
            )
            self.assertEqual(markdown.document_type, "markdown")
            self.assertEqual(
                self.request("get", f"documents/{markdown.id}/preview").status_code, 404
            )

    def test_D03_selected_viewer_formats_private_originals_and_validation(self):
        import io
        import tempfile
        import zipfile

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        from .document_files import DOCUMENT_TYPES, import_document

        self.assertTrue(
            {"doc", "docx", "xls", "xlsx", "ppt", "pptx", "xmind", "png", "json", "md"}
            <= DOCUMENT_TYPES
        )
        self.assertNotIn("markdown", DOCUMENT_TYPES)
        self.assertEqual(len(DOCUMENT_TYPES), 21)
        for removed in ("exe", "zip", "dwg", "mp4", "odt", "rtf"):
            self.assertNotIn(removed, DOCUMENT_TYPES)
            with self.assertRaises(DomainError):
                import_document(
                    self.a, self.p.id, SimpleUploadedFile("removed." + removed, b"payload")
                )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("content.json", '[{"rootTopic":{"title":"计划"}}]')
        with tempfile.TemporaryDirectory() as storage, override_settings(MEDIA_ROOT=storage):
            for extension, content in [
                ("xmind", archive.getvalue()),
                ("json", b'{"hello":"world"}'),
                ("md", b"# Original"),
                ("png", b"\x89PNG\r\n\x1a\n"),
            ]:
                record = import_document(
                    self.a, self.p.id, SimpleUploadedFile("sample." + extension, content)
                )
                response = self.request("get", f"documents/{record.id}/preview")
                self.assertEqual(b"".join(response.streaming_content), content)
                self.assertEqual(response["X-Content-Type-Options"], "nosniff")
                response.close()
                self.assertEqual(
                    self.request(
                        "get", f"documents/{record.id}/preview", user=self.out
                    ).status_code,
                    404,
                )
            for content in (b"notzip", b"PK\x03\x04broken"):
                with self.assertRaises(DomainError):
                    import_document(self.a, self.p.id, SimpleUploadedFile("invalid.xmind", content))
            crowded = io.BytesIO()
            with zipfile.ZipFile(crowded, "w") as zipped:
                for index in range(10001):
                    zipped.writestr(str(index), "")
            with self.assertRaises(DomainError):
                import_document(
                    self.a, self.p.id, SimpleUploadedFile("crowded.xmind", crowded.getvalue())
                )

    def test_D04_folders_scope_upload_delete_and_legacy_creation_removed(self):
        import tempfile

        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        from .document_files import import_document

        folder = s.document_write(self.a, self.p.id, {"title": "资料", "document_type": "folder"})
        child = s.document_write(
            self.b,
            self.p.id,
            {"title": "子目录", "document_type": "folder", "parent": str(folder.id)},
        )
        with self.assertRaises(DomainError):
            s.document_write(self.a, self.p.id, {"title": "资料", "document_type": "folder"})
        with self.assertRaises(DomainError):
            s.document_write(self.a, self.p.id, {"title": "新建", "body": "禁用"})
        self.assertEqual(
            self.request(
                "post", f"projects/{self.p.id}/documents", {"title": "禁用", "body": "x"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.request(
                "get", f"projects/{self.p.id}/documents?parent={child.id}", user=self.out
            ).status_code,
            404,
        )
        outside = s.create_project(
            self.a, {"name": "其他项目", "code": "FOLDEROTHER", "owner": str(self.a.id)}
        )
        with self.assertRaises(DomainError):
            s.document_write(
                self.a,
                outside.id,
                {"title": "跨项目", "document_type": "folder", "parent": str(folder.id)},
            )
        with tempfile.TemporaryDirectory() as storage, override_settings(MEDIA_ROOT=storage):
            doc = import_document(
                self.a, self.p.id, SimpleUploadedFile("说明.txt", b"hello"), child.id
            )
            self.assertEqual(doc.parent, child)
            root = self.request("get", f"projects/{self.p.id}/documents").data
            self.assertEqual([row["id"] for row in root["items"]], [str(folder.id)])
            listing = self.request("get", f"projects/{self.p.id}/documents?parent={child.id}").data
            self.assertEqual([row["id"] for row in listing["items"]], [str(doc.id)])
            self.assertEqual([row["title"] for row in listing["ancestors"]], ["资料", "子目录"])
            with self.assertRaises(DomainError):
                s.document_write(
                    self.a, self.p.id, {"version": child.version}, child.id, delete=True
                )
            with self.assertRaises(DomainError):
                import_document(
                    self.a, outside.id, SimpleUploadedFile("越权.txt", b"data"), folder.id
                )
            s.document_write(self.a, self.p.id, {"version": doc.version}, doc.id, delete=True)
            s.document_write(self.a, self.p.id, {"version": child.version}, child.id, delete=True)
            with self.assertRaises(DomainError):
                import_document(
                    self.a, self.p.id, SimpleUploadedFile("已删除.txt", b"data"), child.id
                )
        member = m.Member.objects.get(project=self.p, user=self.b)
        member.role = "readonly"
        member.save()
        with self.assertRaises(DomainError):
            s.document_write(self.b, self.p.id, {"title": "禁止", "document_type": "folder"})

    def test_W09_default_category_filter_is_null_and_project_scoped(self):
        category = m.Category.objects.create(project=self.p, name="界面")
        for kind in ("requirement", "task", "bug"):
            extra = {"steps_to_reproduce": "操作", "actual_result": "异常"} if kind == "bug" else {}
            plain = s.create_item(
                self.a, self.p.id, {"type": kind, "title": "默认" + kind, **extra}
            )
            tagged = s.create_item(
                self.a,
                self.p.id,
                {"type": kind, "title": "分类" + kind, "category": str(category.id), **extra},
            )
            base = f"projects/{self.p.id}/work-items?type={kind}"
            self.assertEqual(self.request("get", base).data["total"], 2)
            result = self.request("get", base + "&category=none").data
            self.assertEqual([row["id"] for row in result["items"]], [str(plain.id)])
            result = self.request("get", base + "&category=" + str(category.id)).data
            self.assertEqual([row["id"] for row in result["items"]], [str(tagged.id)])
            self.assertEqual(
                self.request("get", base + "&category=none", user=self.out).status_code, 404
            )

    def test_W09_category_delete_moves_all_types_only_after_confirmation(self):
        category = s.config_write(self.a, m.Category, {"name": "待移除分类"}, pid=self.p.id)
        path = f"projects/{self.p.id}/categories/{category.id}"
        items = []
        for kind in ["requirement", "task", "bug"]:
            items.append(
                s.create_item(
                    self.a,
                    self.p.id,
                    {
                        "type": kind,
                        "title": kind,
                        "category": str(category.id),
                        "steps_to_reproduce": "操作",
                        "actual_result": "异常",
                    },
                )
            )
        payload = {"version": category.version}
        self.assertEqual(
            self.request("patch", path, {**payload, "name": "越权"}, self.b).status_code, 403
        )
        self.assertEqual(
            self.request("delete", path, {**payload, "confirm": True}, self.b).status_code, 403
        )
        result = self.request("delete", path, payload, self.a)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.data["code"], "CATEGORY_MOVE_CONFIRMATION_REQUIRED")
        self.assertEqual(m.WorkItem.objects.filter(category=category).count(), 3)
        self.assertEqual(
            self.request("delete", path, {**payload, "confirm": True}, self.a).status_code, 204
        )
        category.refresh_from_db()
        self.assertIsNotNone(category.deleted_at)
        for item in items:
            previous = item.version
            item.refresh_from_db()
            self.assertIsNone(item.category_id)
            self.assertEqual(item.version, previous + 1)
            self.assertTrue(
                m.Audit.objects.filter(entity_id=str(item.id), action="update").exists()
            )

    def test_W09_empty_category_delete_and_stale_version(self):
        category = s.config_write(self.a, m.Category, {"name": "空分类"}, pid=self.p.id)
        path = f"projects/{self.p.id}/categories/{category.id}"
        self.assertEqual(
            self.request(
                "post", f"projects/{self.p.id}/categories", {"name": "越权"}, self.b
            ).status_code,
            403,
        )
        self.assertEqual(
            self.request("delete", path, {"version": category.version + 1}, self.a).status_code, 409
        )
        self.assertEqual(
            self.request("delete", path, {"version": category.version}, self.a).status_code, 204
        )

    def test_C04_project_dictionary_templates_are_independent_and_scoped(self):
        template = s.config_write(self.admin, m.Priority, {"name": "模板新来源", "kind": "source"})
        other = s.create_project(self.a, {"code": "DICT", "name": "独立字典"})
        copied = m.Priority.objects.get(project=other, kind="source", code=template.code)
        s.config_write(
            self.admin, m.Priority, {"version": template.version, "name": "模板已修改"}, template.id
        )
        copied.refresh_from_db()
        self.assertEqual(copied.name, "模板新来源")
        self.assertFalse(m.Priority.objects.filter(project=self.p, code=template.code).exists())
        path = f"projects/{self.p.id}/dictionaries"
        self.assertEqual(
            self.request(
                "post", path, {"kind": "environment", "name": "成员禁止"}, self.b
            ).status_code,
            403,
        )
        self.assertEqual(self.request("get", "dictionaries", user=self.b).status_code, 403)
        env = self.request("post", path, {"kind": "environment", "name": "预发环境"}, self.a)
        self.assertEqual(env.status_code, 201)
        self.assertEqual(
            self.request(
                "patch",
                f"projects/{other.id}/dictionaries/{env.data['id']}",
                {"version": 1, "name": "跨项目"},
            ).status_code,
            404,
        )
        bug = s.create_item(
            self.a,
            self.p.id,
            {"type": "bug", "title": "无需复现字段", "environment": env.data["code"]},
        )
        self.assertEqual(m.BugDetail.objects.get(item=bug).environment, env.data["code"])
        self.assertEqual(
            self.request("delete", path + "/" + env.data["id"], {"version": 1}).status_code, 422
        )
        self.assertEqual(
            self.request(
                "patch", path + "/" + env.data["id"], {"version": 1, "enabled": False}
            ).status_code,
            200,
        )
        self.assertEqual(
            self.request(
                "patch", f"work-items/{bug.id}", {"version": bug.version, "title": "保留历史值"}
            ).status_code,
            200,
        )
        with self.assertRaises(DomainError):
            s.create_item(
                self.a,
                self.p.id,
                {"type": "bug", "title": "停用值", "environment": env.data["code"]},
            )
        with self.assertRaises(DomainError):
            s.create_item(
                self.a,
                self.p.id,
                {
                    "type": "task",
                    "title": "跨项目优先级",
                    "priority": str(s.default_priority(other)),
                },
            )
        with self.assertRaises(DomainError):
            s.create_item(
                self.a,
                self.p.id,
                {"type": "requirement", "title": "跨项目来源", "source": copied.code},
            )

    def test_C04_dictionary_custom_values_reorder_and_version(self):
        base = f"projects/{self.p.id}/dictionaries"
        first = self.request("post", base, {"kind": "severity", "name": "阻塞"}).data
        second = self.request("post", base, {"kind": "severity", "name": "建议"}).data
        order = {
            "kind": "severity",
            "item_id": second["id"],
            "version": second["version"],
            "target_id": first["id"],
            "target_version": first["version"],
            "placement": "before",
        }
        self.assertEqual(self.request("post", base + "/reorder", order, self.b).status_code, 403)
        self.assertEqual(self.request("post", base + "/reorder", order).status_code, 200)
        self.assertEqual(self.request("post", base + "/reorder", order).status_code, 409)
        bug = s.create_item(
            self.a, self.p.id, {"type": "bug", "title": "自定义程度", "severity": first["code"]}
        )
        self.assertEqual(m.BugDetail.objects.get(item=bug).severity, first["code"])
        self.assertEqual(
            self.request("post", base, {"kind": "severity", "name": "阻塞"}).status_code, 422
        )
        self.assertEqual(
            self.request(
                "patch",
                base + "/" + str(self.priority.id),
                {"version": self.priority.version, "enabled": False},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.request(
                "patch",
                base + "/" + str(self.high.id),
                {"version": self.high.version, "enabled": False},
            ).status_code,
            422,
        )

    def test_C05_custom_workflow_states_transitions_completion_and_reopen(self):
        spec = defaults()
        spec["task"] = {
            "states": [
                {
                    "code": "queued",
                    "name": "排队",
                    "color": "blue",
                    "order": 0,
                    "category": "pending",
                    "initial": True,
                },
                {
                    "code": "testing",
                    "name": "测试中",
                    "color": "orange",
                    "order": 1,
                    "category": "pending",
                    "initial": False,
                },
                {
                    "code": "delivered",
                    "name": "已交付",
                    "color": "green",
                    "order": 2,
                    "category": "completed",
                    "initial": False,
                },
                {
                    "code": "withdrawn",
                    "name": "已撤回",
                    "color": "default",
                    "order": 3,
                    "category": "cancelled",
                    "initial": False,
                },
            ],
            "transitions": [
                {"from": a, "to": b, "enabled": True}
                for a, b in [
                    ("queued", "testing"),
                    ("testing", "delivered"),
                    ("delivered", "testing"),
                    ("queued", "withdrawn"),
                ]
            ],
        }
        path = f"projects/{self.p.id}/workflow"
        self.assertEqual(
            self.request(
                "patch", path, {"version": self.p.version, "workflow": spec}, self.b
            ).status_code,
            403,
        )
        saved = self.request("patch", path, {"version": self.p.version, "workflow": spec})
        self.assertEqual(saved.status_code, 200)
        item = self.task()
        self.assertEqual(item.status, "queued")
        with self.assertRaises(DomainError):
            self.transition(item, "delivered")
        self.transition(item, "testing")
        self.transition(item, "delivered")
        item.refresh_from_db()
        self.assertEqual(item.status_category, "completed")
        self.assertIsNotNone(item.completed_at)
        self.assertEqual(self.request("get", "me/todos", user=self.b).data["total"], 0)
        report = self.request("get", f"projects/{self.p.id}/reports/overview").data
        self.assertEqual(report["completed"], 1)
        self.assertEqual(report["completion_rate"], 1)
        self.assertEqual(report["unfinished"], 0)
        self.transition(item, "testing")
        item.refresh_from_db()
        self.assertEqual(item.status_category, "pending")
        self.assertIsNone(item.completed_at)
        self.assertEqual(self.request("get", "me/todos", user=self.b).data["total"], 1)
        self.assertEqual(self.request("get", f"work-items/{item.id}").data["status_name"], "测试中")

    def test_C05_workflow_template_copy_is_independent_and_admin_only(self):
        original = self.request("get", "workflow-template", user=self.admin).data
        spec = original["workflow"]
        spec["task"]["states"][0]["name"] = "模板待排期"
        data = {"workflow": spec, "version": original["version"]}
        self.assertEqual(self.request("get", "workflow-template", user=self.a).status_code, 403)
        self.assertEqual(self.request("patch", "workflow-template", data, self.a).status_code, 403)
        self.assertEqual(
            self.request("patch", "workflow-template", data, self.admin).status_code, 200
        )
        self.assertEqual(
            self.request("patch", "workflow-template", data, self.admin).status_code, 409
        )
        project = s.create_project(self.a, {"code": "WFTEMPLATE", "name": "流程副本"})
        self.assertEqual(project.workflow["task"]["states"][0]["name"], "模板待排期")
        self.p.refresh_from_db()
        self.assertEqual(self.p.workflow["task"]["states"][0]["name"], "待开始")
        project.workflow["task"]["states"][0]["name"] = "本项目排期"
        s.workflow_write(
            self.a, project.id, {"version": project.version, "workflow": project.workflow}
        )
        self.assertEqual(
            self.request("get", "workflow-template", user=self.admin).data["workflow"]["task"][
                "states"
            ][0]["name"],
            "模板待排期",
        )

    def test_C05_workflow_referenced_state_and_invalid_graph_are_atomic(self):
        import copy

        item = self.task()
        self.p.refresh_from_db()
        original = copy.deepcopy(self.p.workflow)
        bad = copy.deepcopy(original)
        bad["task"]["states"] = [
            state for state in bad["task"]["states"] if state["code"] != item.status
        ]
        bad["task"]["states"][0]["initial"] = True
        bad["task"]["transitions"] = [{"from": "active", "to": "done", "enabled": True}]
        before = m.Audit.objects.count()
        with self.assertRaises(DomainError):
            s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": bad})
        self.p.refresh_from_db()
        self.assertEqual(self.p.workflow, original)
        self.assertEqual(m.Audit.objects.count(), before)
        bad = copy.deepcopy(original)
        bad["task"]["states"][0]["category"] = "completed"
        bad["task"]["states"][0]["initial"] = False
        bad["task"]["states"][1]["initial"] = True
        with self.assertRaises(DomainError):
            s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": bad})
        self.assertEqual(
            self.request(
                "patch",
                f"projects/{self.p.id}/workflow",
                {"version": self.p.version, "workflow": {"task": {"states": None}}},
            ).status_code,
            422,
        )
        bad = copy.deepcopy(original)
        bad["task"]["transitions"].append({"from": "ready", "to": "foreign", "enabled": True})
        with self.assertRaises(DomainError):
            s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": bad})
        s.update_item(self.a, item.id, {"version": item.version}, "delete")
        with self.assertRaises(DomainError):
            s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": bad})

    def test_C05_unused_state_delete_and_custom_edge_save(self):
        spec = defaults()
        spec["task"]["transitions"].append({"from": "ready", "to": "done", "enabled": True})
        spec["task"]["states"] = [
            state for state in spec["task"]["states"] if state["code"] != "review"
        ]
        spec["task"]["transitions"] = [
            edge
            for edge in spec["task"]["transitions"]
            if "review" not in [edge["from"], edge["to"]]
        ]
        for index, state in enumerate(spec["task"]["states"]):
            state["order"] = index
        s.workflow_write(self.a, self.p.id, {"version": self.p.version, "workflow": spec})
        item = self.task()
        self.transition(item, "done")
        item.refresh_from_db()
        self.assertEqual(item.status_category, "completed")

    def test_B01_blank_legacy_fields_allow_bug_creation_and_full_edit(self):
        created = self.request(
            "post",
            f"projects/{self.p.id}/work-items",
            {
                "type": "bug",
                "title": "空旧字段缺陷",
                "steps_to_reproduce": "",
                "actual_result": "",
                "expected_result": "",
            },
        )
        self.assertEqual(created.status_code, 201)
        result = self.request(
            "patch",
            f"work-items/{created.data['id']}",
            {
                "version": created.data["version"],
                "title": "完整编辑空旧字段",
                **created.data["details"],
            },
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["title"], "完整编辑空旧字段")

    def test_C06_semantic_palette_and_manual_color_preservation(self):
        import importlib
        from copy import deepcopy

        from django.apps import apps

        from .colors import dictionary_color

        critical = m.Priority.objects.create(
            project=self.p, kind="severity", name="紧急阻塞", code="palette-critical", color="blue"
        )
        custom = m.Priority.objects.create(
            project=self.p, kind="environment", name="自定义环境", color="purple"
        )
        manual_blue = m.Priority.objects.create(
            project=self.p, kind="source", name="手动蓝色", color="blue"
        )
        m.Audit.objects.create(
            actor=self.a,
            project=self.p,
            entity_type="Priority",
            entity_id=str(manual_blue.id),
            action="update",
            before={"color": "red"},
            after={"color": "blue"},
        )
        self.p.workflow = defaults()
        for spec in self.p.workflow.values():
            for state in spec["states"]:
                state["color"] = "blue"
        self.p.save()
        before = deepcopy(self.p.workflow)
        next(state for state in before["task"]["states"] if state["code"] == "review")["color"] = (
            "purple"
        )
        m.Audit.objects.create(
            actor=self.a,
            project=self.p,
            entity_type="Project",
            entity_id=str(self.p.id),
            action="workflow",
            before={"workflow": before},
            after={"workflow": self.p.workflow},
        )
        importlib.import_module("core.migrations.0009_semantic_configuration_colors").apply_palette(
            apps, None
        )
        critical.refresh_from_db()
        custom.refresh_from_db()
        manual_blue.refresh_from_db()
        self.p.refresh_from_db()
        self.assertEqual(critical.color, "red")
        self.assertEqual(custom.color, "purple")
        self.assertEqual(manual_blue.color, "blue")
        colors = {state["code"]: state["color"] for state in self.p.workflow["task"]["states"]}
        self.assertEqual(colors["done"], "green")
        self.assertEqual(colors["cancelled"], "default")
        self.assertEqual(colors["review"], "blue")
        self.assertEqual(dictionary_color("environment", "production"), "green")
        self.assertEqual(dictionary_color("severity", "major"), "orange")
        value = s.config_write(
            self.a, m.Priority, {"kind": "severity", "name": "轻微建议"}, pid