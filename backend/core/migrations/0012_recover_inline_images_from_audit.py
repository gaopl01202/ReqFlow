import re
from collections import defaultdict

from django.db import migrations

INLINE_ATTACHMENT = re.compile(r"/api/v1/attachments/([0-9a-f-]{36})\?inline=1")


def mark_inline_images_from_history(apps, schema_editor):
    Attachment = apps.get_model("core", "Attachment")
    Audit = apps.get_model("core", "Audit")
    Comment = apps.get_model("core", "Comment")
    WorkItem = apps.get_model("core", "WorkItem")
    alias = schema_editor.connection.alias
    references_by_item = defaultdict(set)
    comment_items = {}

    def collect(item_id, content):
        if content:
            references_by_item[item_id].update(INLINE_ATTACHMENT.findall(content))

    for item in WorkItem.objects.using(alias).only("id", "description").iterator():
        collect(item.id, item.description or "")

    for comment in Comment.objects.using(alias).only("id", "item_id", "body").iterator():
        comment_items[str(comment.id)] = comment.item_id
        collect(comment.item_id, comment.body or "")

    for entry in (
        Audit.objects.using(alias)
        .filter(entity_type__in=["WorkItem", "Comment"])
        .only("entity_type", "entity_id", "before", "after")
        .iterator()
    ):
        if entry.entity_type == "WorkItem":
            item_id = entry.entity_id
            field = "description"
        else:
            item_id = comment_items.get(entry.entity_id)
            field = "body"
        if item_id is None:
            continue
        for snapshot in (entry.before, entry.after):
            if isinstance(snapshot, dict):
                collect(item_id, snapshot.get(field) or "")

    for item_id, references in references_by_item.items():
        if references:
            Attachment.objects.using(alias).filter(item_id=item_id, id__in=references).update(
                is_inline_image=True
            )


class Migration(migrations.Migration):
    dependencies = [("core", "0011_attachment_inline_image")]

    operations = [migrations.RunPython(mark_inline_images_from_history, migrations.RunPython.noop)]
