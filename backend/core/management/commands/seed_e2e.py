import secrets

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import models as m
from core.policies import DEFAULT_PERMISSIONS, PERMISSIONS


class Command(BaseCommand):
    help = "仅开发模式创建独立浏览器测试账号，密码写入受忽略的本地文件"

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("仅限开发模式")
        ag, _ = m.UserGroup.objects.get_or_create(
            name="系统管理员", defaults={"builtin": True, "permissions": PERMISSIONS}
        )
        m.UserGroup.objects.get_or_create(
            name="普通用户",
            defaults={"builtin": True, "permissions": DEFAULT_PERMISSIONS},
        )
        pos, _ = m.Position.objects.get_or_create(name="团队成员")
        for name, order, color in [
            ("高", 0, "red"),
            ("中", 1, "blue"),
            ("低", 2, "default"),
        ]:
            m.Priority.objects.get_or_create(
                project=None,
                kind="priority",
                name=name,
                defaults={"sort_order": order, "color": color},
            )
        user, _ = m.User.objects.get_or_create(
            username="e2e-local",
            defaults={
                "display_name": "本地验收",
                "group": ag,
                "position": pos,
                "is_superuser": True,
                "must_change_password": False,
            },
        )
        password = secrets.token_urlsafe(24)
        user.set_password(password)
        user.save()
        path = settings.BASE_DIR.parent / ".local" / "e2e-password"
        path.parent.mkdir(exist_ok=True)
        path.write_text(password)
        path.chmod(0o600)
        self.stdout.write("本地测试账号已准备；凭据仅保存在 .local/")
