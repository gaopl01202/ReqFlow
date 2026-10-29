import json
import logging
import time
import uuid


class RequestIDMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid.uuid4())
        start = time.monotonic()
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        logging.getLogger("reqflow.requests").info(
            json.dumps(
                {
                    "request_id": request.request_id,
                    "method": request.method,
                    "path": request.path,
                    "status": response.status_code,
                    "duration_ms": round((time.monotonic() - start) * 1000),
                },
                ensure_ascii=False,
            )
        )
        return response


class SessionLifetimeMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.contrib.auth import logout
        from django.http import JsonResponse
        from django.utils import timezone

        from .sessions import session_deadline

        if request.user.is_authenticated:
            deadline = session_deadline(request)
            if (
                deadline is None
                or timezone.now().timestamp() >= deadline
                or not (
                    request.user.is_superuser
                    or (request.user.group_id and request.user.group.enabled)
                )
            ):
                logout(request)
                if request.path.startswith("/api/v1/") and request.path not in [
                    "/api/v1/auth/login",
                    "/api/v1/auth/csrf",
                    "/api/v1/health",
                ]:
                    response = JsonResponse(
                        {
                            "code": "SESSION_EXPIRED",
                            "message": "登录已过期，请重新登录",
                            "fields": {},
                            "request_id": getattr(request, "request_id", ""),
                        },
                        status=401,
                    )
                    response["Cache-Control"] = "no-store"
                    return response
        response = self.get_response(request)
        if request.path.startswith("/api/v1/auth/"):
            response["Cache-Control"] = "no-store"
        return response
