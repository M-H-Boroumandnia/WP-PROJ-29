from __future__ import annotations

from typing import Any

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from core.exceptions import SonoraError
from accounts.models import (
    ArtistProfile,
    User,
)
from billing.models import Subscription
from notifications.models import Notification
from accounts.serializers import (
    LoginSerializer,
    MeSerializer,
    RegisterSerializer,
)
from notifications.services import (
    create_audit,
    create_notification,
    notify_staff,
)
from accounts.tokens import (
    set_refresh_cookie,
    token_payload,
    username_from,
)
from core.views import SonoraAPIView


class RegisterView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

    @transaction.atomic
    def post(self, request: Request, artist: bool = False) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = User.objects.create_user(
            email=data["email"],
            password=data["password"],
            username=username_from(data.get("stageName") or data["displayName"]),
            display_name=data["displayName"].strip(),
            birth_date=data["birthDate"],
            gender=data.get("gender"),
            locale=data["locale"],
            timezone=data["timezone"],
        )
        Subscription.basic_for(user)
        if artist:
            stage = data.get("stageName", "").strip()
            if not stage:
                raise SonoraError(
                    "stage_name_required", "Stage name is required for artist registration."
                )
            ArtistProfile.objects.create(user=user, stage_name=stage)
            notify_staff(
                "New artist registration",
                f"{stage} joined Sonora and needs verification.",
                kind=Notification.Kind.IMPORTANT,
                title_key="noticeArtistRegisteredTitle",
                body_key="noticeArtistRegisteredBody",
                values={"name": stage, "email": user.email},
            )
        create_notification(
            user,
            "Welcome to Sonora",
            "Your listening space is ready.",
            Notification.Kind.IMPORTANT,
            "noticeWelcomeTitle",
            "noticeWelcomeBody",
        )
        payload = token_payload(user, request)
        response = Response(payload, status=status.HTTP_201_CREATED)
        set_refresh_cookie(response, payload["refresh"])
        return response


class LoginView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = LoginSerializer

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        payload = token_payload(user, request)
        response = Response(payload)
        set_refresh_cookie(response, payload["refresh"])
        return response


class RefreshView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]
    # Ignore an expired Bearer on this endpoint; refresh uses cookie/body only.
    authentication_classes = []

    def post(self, request: Request) -> Response:
        refresh_value = request.COOKIES.get("sonora_refresh") or request.data.get("refresh")
        if not refresh_value:
            raise SonoraError(
                "refresh_missing", "Refresh token is missing.", status.HTTP_401_UNAUTHORIZED
            )
        try:
            refresh = RefreshToken(refresh_value)
            access = refresh.access_token
            user = User.objects.get(id=refresh["user_id"], deleted_at__isnull=True)
        except (TokenError, User.DoesNotExist, KeyError) as exc:
            raise SonoraError(
                "refresh_invalid",
                "Refresh token is invalid or expired.",
                status.HTTP_401_UNAUTHORIZED,
            ) from exc
        new_refresh = RefreshToken.for_user(user)
        payload = {
            "access": str(access),
            "user": MeSerializer(user, context={"request": request, "viewer": user}).data,
        }
        if settings.SONORA_DEMO_MODE:
            payload["refresh"] = str(new_refresh)
        response = Response(payload)
        set_refresh_cookie(response, str(new_refresh))
        return response


class LogoutView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        refresh_value = request.data.get("refresh") or request.COOKIES.get("sonora_refresh")
        if refresh_value:
            try:
                RefreshToken(refresh_value).blacklist()
            except TokenError:
                pass
        response = Response({"ok": True})
        response.delete_cookie("sonora_refresh", path="/api/v1/auth/")
        return response


class PasswordResetRequestView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        email = str(request.data.get("email", "")).strip().lower()
        response: dict[str, Any] = {
            "ok": True,
            "message": "If an account exists, reset instructions will be sent.",
        }
        user = User.objects.filter(email=email, deleted_at__isnull=True, is_active=True).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            create_audit(
                user, "password_reset_requested", "user", str(user.id), None, {"email": email}
            )
            if settings.SONORA_DEMO_MODE:
                response["debugReset"] = {"uid": uid, "token": token}
        return Response(response)


class PasswordResetConfirmView(SonoraAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        uid = str(request.data.get("uid", ""))
        token = str(request.data.get("token", ""))
        password = str(request.data.get("password") or request.data.get("newPassword") or "")
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id, deleted_at__isnull=True, is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            raise SonoraError(
                "reset_invalid",
                "Password reset link is invalid or expired.",
                status.HTTP_400_BAD_REQUEST,
            )
        if not default_token_generator.check_token(user, token):
            raise SonoraError(
                "reset_invalid",
                "Password reset link is invalid or expired.",
                status.HTTP_400_BAD_REQUEST,
            )
        validate_password(password, user)
        user.set_password(password)
        user.save(update_fields=["password"])
        create_audit(
            user, "password_reset_confirmed", "user", str(user.id), None, {"email": user.email}
        )
        return Response({"ok": True, "message": "Password has been reset."})
