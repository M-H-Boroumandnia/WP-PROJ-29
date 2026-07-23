from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent

SECRET_KEY = os.environ.get("SONORA_SECRET_KEY", "sonora-dev-only-change-me-with-at-least-32-bytes")
DEBUG = os.environ.get("SONORA_DEBUG", "1") == "1"
ALLOWED_HOSTS = [host.strip() for host in os.environ.get("SONORA_ALLOWED_HOSTS", "127.0.0.1,localhost,testserver").split(",") if host.strip()]
CSRF_TRUSTED_ORIGINS = [origin for origin in os.environ.get("SONORA_CSRF_TRUSTED_ORIGINS", "http://127.0.0.1:5173,http://127.0.0.1:4174,http://127.0.0.1:4175").split(",") if origin]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "drf_spectacular",
    "channels",
    "api",
]

MIDDLEWARE = [
    "api.middleware.RequestIdMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "sonora.urls"
ASGI_APPLICATION = "sonora.asgi.application"
WSGI_APPLICATION = "sonora.wsgi.application"
AUTH_USER_MODEL = "api.User"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

db_url = os.environ.get("DATABASE_URL")
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

if db_url and db_url.startswith("postgresql://"):
    from urllib.parse import urlparse

    parsed = urlparse(db_url)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": parsed.username,
            "PASSWORD": parsed.password,
            "HOST": parsed.hostname,
            "PORT": parsed.port or 5432,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.environ.get("SONORA_SQLITE_PATH", str(BASE_DIR / "db.sqlite3")),
        }
    }

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
PRIVATE_MEDIA_ROOT = BASE_DIR / "private_media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = [origin for origin in os.environ.get("SONORA_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4174,http://127.0.0.1:4175").split(",") if origin]
CORS_ALLOW_CREDENTIALS = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "api.exceptions.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": (
        "api.throttles.LoginThrottle",
        "api.throttles.UploadThrottle",
        "api.throttles.TelemetryThrottle",
        "api.throttles.SensitiveActionThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
        "upload": "30/hour",
        "telemetry": "180/min",
        "sensitive": "60/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Sonora API",
    "DESCRIPTION": "Backend API for Sonora music streaming.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CHANNEL_REDIS_URL = os.environ.get("REDIS_URL")
if CHANNEL_REDIS_URL:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [CHANNEL_REDIS_URL]}}}
else:
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", os.environ.get("REDIS_URL", "memory://"))
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "cache+memory://")
CELERY_TASK_ALWAYS_EAGER = os.environ.get("SONORA_CELERY_EAGER", "1") == "1"

SONORA_DEMO_MODE = os.environ.get("SONORA_DEMO_MODE", "1") == "1"
SONORA_FRONTEND_URL = os.environ.get("SONORA_FRONTEND_URL", "http://127.0.0.1:5173")
SONORA_STREAM_SIGNING_MAX_AGE_SECONDS = int(os.environ.get("SONORA_STREAM_SIGNING_MAX_AGE_SECONDS", "600"))
SONORA_FFMPEG_BINARY = os.environ.get("SONORA_FFMPEG_BINARY", "ffmpeg")
