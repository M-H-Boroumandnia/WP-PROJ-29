from __future__ import annotations

from typing import Any

from django.contrib.auth import authenticate
from rest_framework import serializers

from core.exceptions import SonoraError
from accounts.models import User


class RegisterSerializer(serializers.Serializer):
    displayName = serializers.CharField(max_length=120)
    stageName = serializers.CharField(max_length=140, required=False, allow_blank=True)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=10, write_only=True)
    birthDate = serializers.DateField()
    gender = serializers.ChoiceField(choices=User.Gender.choices, allow_null=True)
    locale = serializers.ChoiceField(choices=User.Locale.choices)
    timezone = serializers.CharField(max_length=64)

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value, deleted_at__isnull=True).exists():
            raise serializers.ValidationError(
                "An account already uses this email.", code="email_exists"
            )
        return value.lower()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user = authenticate(email=attrs["email"].lower(), password=attrs["password"])
        if not user or user.deleted_at:
            raise SonoraError("invalid_credentials", "Email or password is incorrect.")
        attrs["user"] = user
        return attrs
