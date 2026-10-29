from core.api import Endpoint
from django.http import JsonResponse
from django.urls import path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

ROUTES = [
    "health",
    "auth/csrf",
    "auth/login",
    "auth/logout",
    "auth/me",
    "auth/activity",
    "auth/change-password",
    "directory",
    "operation-logs",
    "links/<str:project_code>/<str:kind>/<str:reference>",
    "attachments/<uuid:id>/metadata",
    "workspace/context",
    "projects/<uuid:id>/context",
    "users",
    "users/<uuid:id>",
    "users/<uuid:id>/activate",
    "users/<uuid:id>/deactivate",
    "users/<uuid:id>/reset-password",
    "user-groups",
    "user-groups/<uuid:id>",
    "positions",
    "positions/reorder",
    "positions/<uuid:id>",
    "dictionaries",
    "dictionaries/reorder",
    "dictionaries/<uuid:id>",
    "projects/<uuid:id>/dictionaries",
    "projects/<uuid:id>/dictionaries/reorder",
    "projects/<uuid:id>/dictionaries/<uuid:dictionary_id>",
    "priorities",
    "priorities/reorder",
    "priorities/<uuid:id>",
    "workflow-template",
    "projects",
    "projects/<uuid:id>",
    "projects/<uuid:id>/close",
    "projects/<uuid:id>/reopen",
    "projects/<uuid:id>/members",
    "projects/<uuid:id>/members/<uuid:user_id>",
    "projects/<uuid:id>/members/bulk",
    "projects/<uuid:id>/members/bulk-delete",
    "projects/<uuid:id>/work-items",
    "projects/<uuid:id>/iterations",
    "projects/<uuid:id>/documents",
    "projects/<uuid:id>/documents/import",
    "projects/<uuid:id>/categories",
    "projects/<uuid:id>/categories/reorder",
    "projects/<uuid:id>/categories/<uuid:category_id>",
    "projects/<uuid:id>/workflow",
    "projects/<uuid:id>/board",
    "projects/<uuid:id>/recycle-bin",
    "recycle-bin",
    "projects/<uuid:id>/reports/overview",
    "projects/<uuid:id>/reports/members",
    "projects/<uuid:id>/reports/bugs",
    "projects/<uuid:id>/reports/export",
    "work-items/bulk-update",
    "work-items/<uuid:id>",
    "work-items/<uuid:id>/transition",
    "work-items/<uuid:id>/restore",
    "work-items/<uuid:id>/comments",
    "work-items/<uuid:id>/attachments",
    "work-items/<uuid:id>/history",
    "comments/<uuid:id>",
    "attachments/<uuid:id>",
    "documents/<uuid:id>",
    "documents/<uuid:id>/attachments",
    "documents/<uuid:id>/preview",
    "documents/<uuid:id>/download",
    "iterations/<uuid:id>",
    "iterations/<uuid:id>/start",
    "iterations/<uuid:id>/finish",
    "iterations/<uuid:id>/work-items/<uuid:item_id>",
    "iterations/<uuid:id>/reports/progress",
    "me/todos",
    "me/dashboard",
    "me/notifications",
    "me/notifications/mark-all-read",
    "notifications/<uuid:id>",
]
urlpatterns = [
    path("api/v1/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs", SpectacularSwaggerView.as_view(url_name="schema")),
] + [path("api/v1/" + route, Endpoint.as_view()) for route in ROUTES]


def allowed(route):
    last = route.split("/")[-1]
    if last in [
        "import",
        "close",
        "reopen",
        "transition",
        "restore",
        "start",
        "finish",
        "activate",
        "deactivate",
        "reset-password",
        "mark-all-read",
        "bulk-update",
        "bulk",
        "bulk-delete",
        "reorder",
        "login",
        "logout",
        "change-password",
        "activity",
    ]:
        return ["post", "options"]
    if (
        route
        in [
            "health",
            "auth/csrf",
            "auth/me",
            "directory",
            "operation-logs",
            "workspace/context",
            "me/todos",
            "me/dashboard",
            "me/notifications",
        ]
        or route.startswith("links/")
        or route.endswith("/metadata")
        or route.endswith("/context")
        or "/reports/" in route
        or last in ["board", "history", "recycle-bin", "preview", "download"]
    ):
        return ["get", "options"]
    if route.startswith("notifications/"):
        return ["patch", "options"]
    if "/iterations/" in "/" + route and "/work-items/" in route:
        return ["post", "delete", "options"]
    if last in ["workflow", "workflow-template"]:
        return ["get", "patch", "options"]
    if last.startswith("<"):
        if route.startswith("attachments/"):
            return ["get", "delete", "options"]
        if route.startswith("comments/"):
            return ["patch", "delete", "options"]
        if route.startswith("projects/") and route.count("/") == 1:
            return ["get", "patch", "options"]
        if route.startswith("iterations/"):
            return ["get", "patch", "options"]
        return ["get", "patch", "delete", "options"]
    return ["get", "post", "options"]


urlpatterns = urlpatterns[:2] + [
    path("api/v1/" + route, Endpoint.as_view(http_method_names=allowed(route))) for route in ROUTES
]


def api_not_found(request):
    return JsonResponse(
        {
            "code": "NOT_FOUND",
            "message": "接口不存在",
            "fields": {},
            "request_id": getattr(request, "request_id", ""),
        },
        status=404,
    )


urlpatterns.append(re_path(r"^api/v1/.*$", api_not_found))
