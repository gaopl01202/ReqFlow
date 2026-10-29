"""Notification descriptions shared by delivery, historical display and search."""

import re

EVENT_LABELS = {
    "assignment": "已指派给你处理",
    "status": "工作流状态已变更",
    "comment": "有新评论",
    "mention": "在评论中提到了你",
    "due": "即将到期",
    "overdue": "已逾期，请及时处理",
}


def notification_message(message, event_type):
    label = EVENT_LABELS.get(event_type)
    if not label:
        return message
    # Only replace the generated suffix; never translate a user's title/content.
    return re.sub(r"[：:]\s*" + re.escape(event_type) + r"\s*$", "：" + label, message)
