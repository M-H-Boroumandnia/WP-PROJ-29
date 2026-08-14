from __future__ import annotations

from django.db import models
from django.utils import timezone

from catalog.models import Track
from core.models import TimeStampedModel
from accounts.models import User


class ListeningRoom(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    invite_code = models.CharField(max_length=12, unique=True)
    host = models.ForeignKey(User, related_name="hosted_rooms", on_delete=models.PROTECT)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    current_queue_item = models.ForeignKey(
        "RoomQueueItem", null=True, blank=True, related_name="+", on_delete=models.SET_NULL
    )
    position_seconds = models.FloatField(default=0)
    is_playing = models.BooleanField(default=False)
    repeat_mode = models.CharField(max_length=8, default="off")
    shuffle_enabled = models.BooleanField(default=False)


class RoomParticipant(TimeStampedModel):
    room = models.ForeignKey(ListeningRoom, related_name="participants", on_delete=models.CASCADE)
    user = models.ForeignKey(User, related_name="room_participations", on_delete=models.CASCADE)
    joined_at = models.DateTimeField(default=timezone.now)
    last_activity_at = models.DateTimeField(default=timezone.now)
    left_at = models.DateTimeField(null=True, blank=True)
    can_control = models.BooleanField(default=False)

    class Meta:
        unique_together = [("room", "user")]


class RoomQueueItem(TimeStampedModel):
    room = models.ForeignKey(ListeningRoom, related_name="queue_items", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, on_delete=models.PROTECT)
    added_by = models.ForeignKey(
        User, related_name="room_queue_additions", on_delete=models.PROTECT
    )
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
