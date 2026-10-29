"""Rolling idle session lifetimes, independent of background polling."""

from datetime import datetime
from datetime import timezone as datetime_timezone

from django.conf import settings
from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver
from django.utils import timezone

STARTED = "reqflow_started_at"
ACTIVITY = "reqflow_activity_at"


@receiver(user_logged_in, dispatch_uid="reqflow_session_start")
def start_session(sender, request, user, **kwargs):
    now = timezone.now().timestamp()
    request.session[STARTED] = now
    request.session[ACTIVITY] = now
    request.session.set_expiry(
        datetime.fromtimestamp(
            now + settings.SESSION_IDLE_TIMEOUT_SECONDS, tz=datetime_timezone.utc
        )
    )


def session_deadline(request):
    started, activity = request.session.get(STARTED), request.session.get(ACTIVITY)
    if not isinstance(started, (int, float)) or not isinstance(activity, (int, float)):
        return None
    return activity + settings.SESSION_IDLE_TIMEOUT_SECONDS


def session_activity(request):
    if request.session.get(STARTED) is not None:
        now = timezone.now().timestamp()
        request.session[ACTIVITY] = now
        request.session.set_expiry(
            datetime.fromtimestamp(
                now + settings.SESSION_IDLE_TIMEOUT_SECONDS, tz=datetime_timezone.utc
            )
        )
    return session_deadline(request)


def session_state(request):
    deadline = session_deadline(request)
    return {
        "session_expires_at": deadline,
        "session_remaining_seconds": max(0, deadline - timezone.now().timestamp())
        if deadline is not None
        else None,
    }


def revoke_user_sessions(user):
    """Invalidate every device session after account revocation or password reset."""
    from django.contrib.sessions.models import Session

    for session in Session.objects.filter(expire_date__gt=timezone.now()):
        if session.get_decoded().get("_auth_user_id") == str(user.pk):
            session.delete()
