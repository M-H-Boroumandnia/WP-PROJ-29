from __future__ import annotations

import uuid
from datetime import timedelta

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


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

    def create_user(self, email: str, password: str | None = None, **extra_fields: object) -> "User":
        extra_fields.setdefault("kind", User.Kind.CONSUMER)
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email: str, password: str | None = None, **extra_fields: object) -> "User":
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
    notification_preference = models.CharField(max_length=24, choices=NotificationPreference.choices, default=NotificationPreference.ALL)
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

    artist = models.ForeignKey(ArtistProfile, related_name="verification_requests", on_delete=models.CASCADE)
    portfolio_urls = models.JSONField(default=list)
    supporting_files = models.JSONField(default=list, blank=True)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    reason = models.TextField(null=True, blank=True)
    reviewer = models.ForeignKey(User, null=True, blank=True, related_name="verification_decisions", on_delete=models.SET_NULL)
    decided_at = models.DateTimeField(null=True, blank=True)


class SubscriptionPlan(TimeStampedModel):
    class Tier(models.TextChoices):
        SILVER = "silver", "Silver"
        GOLD = "gold", "Gold"

    tier = models.CharField(max_length=12, choices=Tier.choices)
    duration_months = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(12)])
    monthly_price_rial = models.PositiveIntegerField()
    discount_percent = models.PositiveSmallIntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(100)])
    is_available = models.BooleanField(default=True)
    label = models.CharField(max_length=120, null=True, blank=True)
    campaign_starts_at = models.DateTimeField(null=True, blank=True)
    campaign_ends_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("tier", "duration_months", "label")]

    @property
    def final_price_rial(self) -> int:
        return round(self.monthly_price_rial * self.duration_months * (1 - self.discount_percent / 100))


class Payment(TimeStampedModel):
    class Provider(models.TextChoices):
        MOCK = "mock", "Mock"
        ZARINPAL = "zarinpal", "Zarinpal"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(User, related_name="payments", on_delete=models.PROTECT)
    plan = models.ForeignKey(SubscriptionPlan, null=True, blank=True, on_delete=models.SET_NULL)
    tier = models.CharField(max_length=12)
    duration_months = models.PositiveSmallIntegerField()
    monthly_price_rial = models.PositiveIntegerField()
    discount_percent = models.PositiveSmallIntegerField()
    final_price_rial = models.PositiveIntegerField()
    provider = models.CharField(max_length=20, choices=Provider.choices, default=Provider.MOCK)
    provider_reference = models.CharField(max_length=140, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)


class Subscription(TimeStampedModel):
    class Tier(models.TextChoices):
        BASIC = "basic", "Basic"
        SILVER = "silver", "Silver"
        GOLD = "gold", "Gold"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"
        SUPERSEDED = "superseded", "Superseded"
        CANCELLED = "cancelled", "Cancelled"

    user = models.ForeignKey(User, related_name="subscriptions", on_delete=models.CASCADE)
    tier = models.CharField(max_length=12, choices=Tier.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    starts_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    source_payment = models.ForeignKey(Payment, null=True, blank=True, related_name="subscriptions", on_delete=models.SET_NULL)

    class Meta:
        indexes = [models.Index(fields=["user", "status"])]

    @property
    def can_upgrade_to_gold(self) -> bool:
        return self.tier != self.Tier.GOLD

    @classmethod
    def basic_for(cls, user: User) -> "Subscription":
        return cls.objects.create(user=user, tier=cls.Tier.BASIC, status=cls.Status.ACTIVE, starts_at=timezone.now())


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
    artist = models.ForeignKey(ArtistProfile, related_name="track_credits", on_delete=models.PROTECT)
    role = models.CharField(max_length=16, choices=Role.choices)


class Follow(TimeStampedModel):
    follower = models.ForeignKey(User, related_name="following_edges", on_delete=models.CASCADE)
    target = models.ForeignKey(User, related_name="follower_edges", on_delete=models.CASCADE)

    class Meta:
        unique_together = [("follower", "target")]


class Playlist(TimeStampedModel):
    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        PUBLIC = "public", "Public"

    owner = models.ForeignKey(User, related_name="playlists", on_delete=models.CASCADE)
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    visibility = models.CharField(max_length=12, choices=Visibility.choices, default=Visibility.PRIVATE)
    cover = models.ImageField(upload_to="playlist_covers/", null=True, blank=True)
    generated_cover = models.BooleanField(default=True)


class PlaylistItem(TimeStampedModel):
    playlist = models.ForeignKey(Playlist, related_name="items", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, on_delete=models.PROTECT)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
        unique_together = [("playlist", "track")]


class SavedPlaylist(TimeStampedModel):
    user = models.ForeignKey(User, related_name="saved_playlists", on_delete=models.CASCADE)
    playlist = models.ForeignKey(Playlist, related_name="saves", on_delete=models.CASCADE)

    class Meta:
        unique_together = [("user", "playlist")]


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


def default_playback_expires_at():
    return timezone.now() + timedelta(minutes=10)


class PlaybackSession(TimeStampedModel):
    user = models.ForeignKey(User, related_name="playback_sessions", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, related_name="playback_sessions", on_delete=models.CASCADE)
    room = models.ForeignKey("ListeningRoom", null=True, blank=True, related_name="playback_sessions", on_delete=models.SET_NULL)
    started_at = models.DateTimeField(default=timezone.now)
    last_position_seconds = models.FloatField(default=0)
    valid_stream_recorded_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(default=default_playback_expires_at)
    unavailable = models.BooleanField(default=False)


class StreamEvent(TimeStampedModel):
    user = models.ForeignKey(User, related_name="stream_events", on_delete=models.CASCADE)
    track = models.ForeignKey(Track, related_name="stream_events", on_delete=models.CASCADE)
    local_day = models.CharField(max_length=10)
    playback_session = models.ForeignKey(PlaybackSession, related_name="stream_events", on_delete=models.CASCADE)

    class Meta:
        unique_together = [("user", "track", "local_day")]


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


class Ticket(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ANSWERED = "answered", "Answered"
        CLOSED = "closed", "Closed"

    creator = models.ForeignKey(User, related_name="tickets", on_delete=models.CASCADE)
    subject = models.CharField(max_length=180)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    claimed_by = models.ForeignKey(User, null=True, blank=True, related_name="claimed_tickets", on_delete=models.SET_NULL)


class TicketMessage(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, related_name="messages", on_delete=models.CASCADE)
    author = models.ForeignKey(User, related_name="ticket_messages", on_delete=models.PROTECT)
    body = models.TextField()


class TicketAttachment(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, related_name="attachments", on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(User, on_delete=models.PROTECT)
    file = models.FileField(upload_to="ticket_attachments/")
    content_type = models.CharField(max_length=120)


class AuditEvent(TimeStampedModel):
    actor = models.ForeignKey(User, null=True, blank=True, related_name="audit_events", on_delete=models.SET_NULL)
    action = models.CharField(max_length=120)
    target = models.CharField(max_length=180)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    request_id = models.CharField(max_length=80)

    class Meta:
        ordering = ["-created_at"]


class ArtistRewardStatement(TimeStampedModel):
    artist = models.ForeignKey(ArtistProfile, related_name="reward_statements", on_delete=models.CASCADE)
    period = models.CharField(max_length=7)
    unique_listeners = models.PositiveIntegerField(default=0)
    valid_streams = models.PositiveIntegerField(default=0)
    amount_rial = models.PositiveIntegerField(default=0)


class Payout(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SETTLED = "settled", "Settled"

    artist = models.ForeignKey(ArtistProfile, related_name="payouts", on_delete=models.PROTECT)
    amount_rial = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    period = models.CharField(max_length=7)
    settled_at = models.DateTimeField(null=True, blank=True)


class ListeningRoom(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    invite_code = models.CharField(max_length=12, unique=True)
    host = models.ForeignKey(User, related_name="hosted_rooms", on_delete=models.PROTECT)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    current_queue_item = models.ForeignKey("RoomQueueItem", null=True, blank=True, related_name="+", on_delete=models.SET_NULL)
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
    added_by = models.ForeignKey(User, related_name="room_queue_additions", on_delete=models.PROTECT)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
