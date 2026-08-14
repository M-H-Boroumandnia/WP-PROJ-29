from __future__ import annotations

from typing import Any

from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from accounts.serializers import MeSerializer


def username_from(display_name: str) -> str:
    base = "".join(ch for ch in display_name.lower() if ch.isalnum())[:18] or "listener"
    candidate = base
    suffix = 1
    while User.objects.filter(username=candidate).exists():
        candidate = f"{base}{suffix}"
        suffix += 1
    return candidate


def token_payload(user: User, request: Request) -> dict[str, Any]:
    refresh = RefreshToken.for_user(user)
    payload = {
        "access": str(refresh.access_token),
        "user": MeSerializer(user, context={"request": request, "viewer": user}).data,
    }
    if settings.SONORA_DEMO_MODE:
        payload["refresh"] = str(refresh)
    return payload


def set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        "sonora_refresh",
        refresh,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="Lax",
        max_age=14 * 24 * 60 * 60,
        path="/api/v1/auth/",
    )
