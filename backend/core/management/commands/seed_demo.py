import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import models as m
from core.demo_data import DemoScenario, write_private


class Command(BaseCommand):
    help = "仅开发模式生成长期使用模拟数据；独立批次、可续跑，保留原数据"

    def add_arguments(self, parser):
        parser.add_argument("--actor", required=True, help="现有系统管理员账号")
        parser.add_argument("--batch", default="demo")
        for name, default in [
            ("users", 24),
            ("projects", 11),
            ("requirement", 110),
            ("task", 320),
            ("bug", 520),
            ("documents", 24),
        ]:
            parser.add_argument("--" + name, type=int, default=default)
        parser.add_argument("--verify-only", action="store_true")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("仅限开发模式，禁止用于生产数据生成")
        batch = options["batch"]
        if not re.fullmatch(r"[a-z][a-z0-9_-]{2,14}", batch):
            raise CommandError("批次需为3至15位小写字母、数字、下划线或短横线，以字母开头")
        if "private_data" in Path(settings.MEDIA_ROOT).parts:
            raise CommandError("禁止使用private_data目录")
        counts = {
            name: options[name]
            for name in ["users", "projects", "requirement", "task", "bug", "documents"]
        }
        if (
            counts["users"] < 16
            or any(value <= 0 for value in counts.values())
            or counts["projects"] > 50
            or max(counts.values()) > 5000
        ):
            raise CommandError("至少16位用户；各项数量须为正，项目不超过50，单项不超过5000")
        actor = m.User.objects.filter(
            username=options["actor"], is_active=True, is_superuser=True, deleted_at=None
        ).first()
        if actor is None:
            raise CommandError("请选择现有启用的系统管理员")
        output = settings.BASE_DIR.parent / ".local" / "demo-data" / batch

        def emit(message):
            self.stdout.write(message)
            self.stdout.flush()

        scenario = DemoScenario(actor, batch, counts, output, emit=emit)
        if options["verify_only"]:
            if not scenario.manifest_path.exists():
                raise CommandError("该批次尚未生成")
            report = scenario.verify()
            write_private(output / "summary.json", report)
        else:
            report = scenario.run()
        self.stdout.write(
            self.style.SUCCESS(
                f"模拟数据校验通过：{report['users']}位用户，{len(report['projects'])}个项目；摘要与私有凭据位于 {output}"
            )
        )
