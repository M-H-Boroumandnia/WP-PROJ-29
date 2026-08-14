from __future__ import annotations

from django.db import models

from core.models import TimeStampedModel
from accounts.models import User


class Notification(TimeStampedModel):
    class Kind(models.TextChoices):
        CRITICAL = "critical", "Critical"
        IMPORTANT = "important", "Important"
        SOCIAL = "social", "Social"
        RELEASE = "release", "Release"

    user = models.ForeignKey(User, related_name="notifications", on_delete=models.CASCADE)
    title = models.CharField(max_length=180)
    body = models.TextField()
    title_key = models.CharField(max_length=80, blank=True)
    body_key = models.CharField(max_length=80, blank=True)
    values = models.JSONField(default=dict, blank=True)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    read_at = models.DateTimeField(null=True, blank=True)
