from __future__ import annotations

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from accounts.models import (
    ArtistProfile,
    User,
)
from core.models import (
    TimeStampedModel,
    default_playback_expires_at,
)


class Release(TimeStampedModel):
    class Type(models.TextChoices):
        ALBUM = "album", "Album"
        SINGLE = "single", "Single"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        SCHEDULED = "scheduled", "Scheduled"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    owner = models.ForeignKey(User, related_name="owned_releases", on_delete=models.PROTECT)
    release_type = models.CharField(max_length=12, choices=Type.choices)
    title = models.CharField(max_length=180)
    cover_original = models.ImageField(upload_to="covers/originals/", null=True, blank=True)
    cover_512 = models.ImageField(upload_to="covers/512/", null=True, blank=True)
    cover_128 = models.ImageField(upload_to="covers/128/", null=True, blank=True)
    cover_url_external = models.CharField(max_length=500, null=True, blank=True)
    genre = models.CharField(max_length=80, blank=True)
    public_release_at = models.DateTimeField(default=timezone.now)
    early_access_starts_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    archived_reason = models.TextField(null=True, blank=True)

    @property
    def public_cover_url(self) -> str | None:
        if self.cover_512:
            return self.cover_512.url
        return self.cover_url_external


class Track(TimeStampedModel):
    release = models.ForeignKey(Release, related_name="tracks", on_delete=models.CASCADE)
    title = models.CharField(max_length=180)
    original_audio = models.FileField(upload_to="audio/originals/", null=True, blank=True)
    processed_audio = models.FileField(upload_to="audio/processed/", null=True, blank=True)
    audio_url_external = models.CharField(max_length=500, null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    lyrics = models.TextField(null=True, blank=True)
    is_explicit = models.BooleanField(default=False)
    processing_state = models.CharField(max_length=16, default="ready")
    processing_error = models.TextField(null=True, blank=True)
    stream_count = models.PositiveIntegerField(default=0)
    unique_listener_count = models.PositiveIntegerField(default=0)

    @property
    def public_audio_url(self) -> str | None:
        if self.processed_audio:
            return self.processed_audio.url
        return self.audio_url_external


class TrackArtistCredit(TimeStampedModel):
    class Role(models.TextChoices):
        PRIMARY = "primary", "Primary"
        FEATURED = "featured", "Featured"
        PRODUCER = "producer", "Producer"

    track = models.ForeignKey(Track, related_name="credits", on_delete=models.CASCADE)
    artist = models.ForeignKey(
        ArtistProfile, related_name="track_credits", on_delete=models.PROTECT
    )
    role = models.CharField(max_length=16, choices=Role.choices)


class Like(TimeStampedModel):
    user = models.ForeignKey(User, related_name="likes", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, related_name="likes", on_delete=models.CASCADE)

    class Meta:
        unique_together = [("user", "track")]


class RecentlyPlayed(TimeStampedModel):
    user = models.ForeignKey(User, related_name="recently_played", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, on_delete=models.CASCADE)
    played_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-played_at"]


class PlaybackSession(TimeStampedModel):
    user = models.ForeignKey(User, related_name="playback_sessions", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, related_name="playback_sessions", on_delete=models.CASCADE)
    room = models.ForeignKey(
        "rooms.ListeningRoom",
        null=True,
        blank=True,
        related_name="playback_sessions",
        on_delete=models.SET_NULL,
    )
    started_at = models.DateTimeField(default=timezone.now)
    last_position_seconds = models.FloatField(default=0)
    valid_stream_recorded_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(default=default_playback_expires_at)
    unavailable = models.BooleanField(default=False)


class StreamEvent(TimeStampedModel):
    user = models.ForeignKey(User, related_name="stream_events", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, related_name="stream_events", on_delete=models.CASCADE)
    local_day = models.CharField(max_length=10)
    playback_session = models.OneToOneField(
        PlaybackSession,
        related_name="stream_event",
        on_delete=models.CASCADE,
    )

    class Meta:
        indexes = [
            models.Index(fields=["user", "local_day"]),
            models.Index(fields=["track", "user"]),
        ]


class PlayerQueue(models.Model):
    user = models.OneToOneField(
        User, related_name="player_queue", on_delete=models.CASCADE, primary_key=True
    )
    track_ids = models.JSONField(default=list, blank=True)
    current_index = models.IntegerField(default=-1)
    repeat_mode = models.CharField(max_length=8, default="off")
    shuffle_enabled = models.BooleanField(default=False)
    volume = models.FloatField(
        default=0.75, validators=[MinValueValidator(0.0), MaxValueValidator(1.0)]
    )
    updated_at = models.DateTimeField(auto_now=True)
