import getpass
import os
import secrets

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core import models as m
from core.policies import DEFAULT_PERMISSIONS, PERMISSIONS


class Command(BaseCommand):
    help = "首次初始化管理员；密码仅从交互终端读取"

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--name", default="系统管理员")
        parser.add_argument(
            "--generate-local-password",
            action="store_true",
            help="仅开发模式：生成一次性密码，保存到忽略的 .local/initial-admin-password.txt",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if m.User.objects.exists():
            raise CommandError("已存在用户，禁止重复初始化")
        generated = options["generate_local_password"]
        path = settings.BASE_DIR.parent / ".local" / "initial-admin-password.txt"
        if generated:
            if not settings.DEBUG:
                raise CommandError("生产初始化必须交互设置密码")
            if path.exists():
                raise CommandError("本地初始密码文件已存在，拒绝覆盖")
            password = secrets.token_urlsafe(24)
        else:
            password = getpass.getpass("管理员密码（至少10位）：")
        if len(password) < 10:
            raise CommandError("密码至少10位")
        group, _ = m.UserGroup.objects.get_or_create(
            name="系统管理员", defaults={"builtin": True, "permissions": PERMISSIONS}
        )
        m.UserGroup.objects.get_or_create(
            name="普通用户",
            defaults={"builtin": True, "permissions": DEFAULT_PERMISSIONS},
        )
        position, _ = m.Position.objects.get_or_create(name="团队成员")
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
        m.User.objects.create_user(
            username=options["username"],
            display_name=options["name"],
            password=password,
            group=group,
            position=position,
            is_superuser=True,
            is_staff=True,
            must_change_password=generated,
        )
        if generated:
            path.parent.mkdir(exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as file:
                file.write(password)
        self.stdout.write(
            self.style.SUCCESS(
                "管理员初始化完成；随机本地密码文件已创建" if generated else "管理员初始化完成"
            )
        )
