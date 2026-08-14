from __future__ import annotations

import uuid

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models

from core.models import TimeStampedModel


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra_fields: object) -> "User":
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(
        self, email: str, password: str | None = None, **extra_fields: object
    ) -> "User":
        extra_fields.setdefault("kind", User.Kind.CONSUMER)
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(
        self, email: str, password: str | None = None, **extra_fields: object
    ) -> "User":
        extra_fields.setdefault("kind", User.Kind.ADMIN)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("username", email.split("@", 1)[0])
        extra_fields.setdefault("display_name", "Sonora Admin")
        extra_fields.setdefault("birth_date", "1990-01-01")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    class Kind(models.TextChoices):
        CONSUMER = "consumer", "Consumer"
        SUPPORT = "support", "Support"
        ADMIN = "admin", "Admin"

    class Gender(models.TextChoices):
        FEMALE = "female", "Female"
        MALE = "male", "Male"
        NON_BINARY = "non_binary", "Non-binary"
        PREFER_NOT = "prefer_not_to_say", "Prefer not to say"

    class Theme(models.TextChoices):
        DARK = "dark", "Dark"
        LIGHT = "light", "Light"
        SYSTEM = "system", "System"

    class Locale(models.TextChoices):
        EN = "en", "English"
        ES = "es", "Spanish"
        DE = "de", "German"
        FR = "fr", "French"
        RU = "ru", "Russian"
        ZH = "zh-CN", "Chinese"

    class NotificationPreference(models.TextChoices):
        ALL = "all", "All"
        IMPORTANT_ONLY = "important_only", "Important only"
        MAX_FIVE_DAILY = "max_five_daily", "Maximum five daily"
        MUTED = "muted", "Muted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    username = models.SlugField(max_length=32, unique=True)
    display_name = models.CharField(max_length=120)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.CONSUMER)
    birth_date = models.DateField()
    gender = models.CharField(max_length=24, choices=Gender.choices, null=True, blank=True)
    avatar_original = models.ImageField(upload_to="avatars/originals/", null=True, blank=True)
    avatar_256 = models.ImageField(upload_to="avatars/256/", null=True, blank=True)
    avatar_64 = models.ImageField(upload_to="avatars/64/", null=True, blank=True)
    avatar_url_external = models.CharField(max_length=500, null=True, blank=True)
    locale = models.CharField(max_length=8, choices=Locale.choices, default=Locale.EN)
    timezone = models.CharField(max_length=64, default="Asia/Tehran")
    theme = models.CharField(max_length=12, choices=Theme.choices, default=Theme.DARK)
    explicit_content_enabled = models.BooleanField(default=True)
    notification_preference = models.CharField(
        max_length=24, choices=NotificationPreference.choices, default=NotificationPreference.ALL
    )
    username_changed_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username", "display_name", "birth_date"]
    objects = UserManager()

    @property
    def public_avatar_url(self) -> str | None:
        if self.avatar_256:
            return self.avatar_256.url
        return self.avatar_url_external

    @property
    def is_staff_user(self) -> bool:
        return self.kind in {self.Kind.SUPPORT, self.Kind.ADMIN}


class ArtistProfile(TimeStampedModel):
    user = models.OneToOneField(User, related_name="artist_profile", on_delete=models.CASCADE)
    stage_name = models.CharField(max_length=140)
    bio = models.TextField(blank=True)
    genre = models.CharField(max_length=80, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)


class ArtistVerificationRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        WITHDRAWN = "withdrawn", "Withdrawn"

    artist = models.ForeignKey(
        ArtistProfile, related_name="verification_requests", on_delete=models.CASCADE
    )
    portfolio_urls = models.JSONField(default=list)
    supporting_files = models.JSONField(default=list, blank=True)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    reason = models.TextField(null=True, blank=True)
    reviewer = models.ForeignKey(
        User,
        null=True,
        blank=True,
        related_name="verification_decisions",
        on_delete=models.SET_NULL,
    )
    decided_at = models.DateTimeField(null=True, blank=True)


class Follow(TimeStampedModel):
    follower = models.ForeignKey(User, related_name="following_edges", on_delete=models.CASCADE)
    target = models.ForeignKey(User, related_name="follower_edges", on_delete=models.CASCADE)

    class Meta:
        unique_together = [("follower", "target")]
