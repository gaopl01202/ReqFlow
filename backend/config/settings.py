import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("SECRET_KEY", "development-only-change-before-deployment")
DEBUG = os.environ.get("DEBUG", "1") == "1"
if not DEBUG and SECRET_KEY.startswith("development-"):
    raise RuntimeError("Production requires SECRET_KEY")
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "drf_spectacular",
    "core.apps.CoreConfig",
]
MIDDLEWARE = [
    "core.middleware.RequestIDMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.SessionLifetimeMiddleware",
]
ROOT_URLCONF = "config.urls"
AUTH_USER_MODEL = "core.User"
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("PGDATABASE", "reqflow"),
        "USER": os.environ.get("PGUSER", ""),
        "PASSWORD": os.environ.get("PGPASSWORD", ""),
        "HOST": os.environ.get("PGHOST", "127.0.0.1"),
        "PORT": os.environ.get("PGPORT", "55432"),
    }
}
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "core.api.exception_handler",
    "UNAUTHENTICATED_USER": None,
}
SPECTACULAR_SETTINGS = {
    "TITLE": "ReqFlow API",
    "VERSION": "1.0.0",
    "ENUM_NAME_OVERRIDES": {
        "LinkResourceTypeEnum": ["requirement", "task", "bug", "document", "iteration"],
        "WorkItemTypeEnum": ["requirement", "task", "bug"],
    },
}
TIME_ZONE = "Asia/Shanghai"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
MEDIA_ROOT = Path(
    os.environ.get("PRIVATE_STORAGE", str(BASE_DIR.parent / ".local" / "attachments"))
)
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
ATTACHMENT_MAX_BYTES = int(os.environ.get("ATTACHMENT_MAX_BYTES", "10485760"))
ATTACHMENT_EXTENSIONS = os.environ.get("ATTACHMENT_EXTENSIONS")
if ATTACHMENT_EXTENSIONS is not None:
    ATTACHMENT_EXTENSIONS = [value.strip().lower() for value in ATTACHMENT_EXTENSIONS.split(",")]
else:
    ATTACHMENT_EXTENSIONS = json.loads(
        (BASE_DIR / "core" / "attachment_formats.json").read_text(encoding="utf-8")
    )["extensions"]
SESSION_IDLE_TIMEOUT_SECONDS = max(1, int(os.environ.get("SESSION_IDLE_TIMEOUT_SECONDS", "604800")))
SESSION_COOKIE_AGE = SESSION_IDLE_TIMEOUT_SECONDS
SESSION_SAVE_EVERY_REQUEST = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
WSGI_APPLICATION = "config.wsgi.application"

CSRF_TRUSTED_ORIGINS = [v for v in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if v]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
if DEBUG:
    CSRF_TRUSTED_ORIGINS += ["http://127.0.0.1:5173", "http://localhost:5173"]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"reqflow.requests": {"handlers": ["console"], "level": "INFO", "propagate": False}},
}

# Imported documents are private and independent from work-item attachment formats.
DOCUMENT_MAX_BYTES = int(os.environ.get("DOCUMENT_MAX_BYTES", "10485760"))
