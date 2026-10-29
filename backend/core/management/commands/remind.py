from django.core.management.base import BaseCommand

from core.services import reminders


class Command(BaseCommand):
    help = "幂等生成到期前一天和每日逾期通知"

    def handle(self, *args, **kwargs):
        reminders()
        self.stdout.write("提醒生成完成")
