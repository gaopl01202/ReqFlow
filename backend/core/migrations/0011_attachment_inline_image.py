import re

from django.db import migrations, models

INLINE_ATTACHMENT = re.compile(r"/api/v1/attachments/([0-9a-f-]{36})\?inline=1")


def mark_existing_inline_images(apps, schema_editor):
    Attachment = apps.get_model("core", "Attachment")
    WorkItem = apps.get_model("core", "WorkItem")
    Comment = apps.get_model("core", "Comment")
    alias = schema_editor.connection.alias

    for item in WorkItem.objects.using(alias).only("id", "description").iterator():
        references = set(INLINE_ATTACHMENT.findall(item.description or ""))
        if references:
            Attachment.objects.using(alias).filter(item_id=item.id, id__in=references).update(
                is_inline_image=True
            )

    for comment in Comment.objects.using(alias).only("item_id", "body").iterator():
        references = set(INLINE_ATTACHMENT.findall(comment.body or ""))
        if references:
            Attachment.objects.using(alias).filter(
                item_id=comment.item_id, id__in=references
            ).update(is_inline_image=True)


class Migration(migrations.Migration):
    dependencies = [("core", "0010_menu_permissions")]

    operations = [
        migrations.AddField(
            model_name="attachment",
            name="is_inline_image",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(mark_existing_inline_images, migrations.RunPython.noop),
    ]
