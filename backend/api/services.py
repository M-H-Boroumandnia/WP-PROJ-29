from __future__ import annotations

import mimetypes
import os
import logging
import secrets
import shutil
import subprocess
import wave
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db import OperationalError, connection, models, transaction
from django.db.models import Count, Q
from django.utils import timezone
from PIL import Image
from rest_framework import status

from .exceptions import SonoraError
from .models import (
    AuditEvent,
    Like,
    ListeningRoom,
    Notification,
    Payment,
    PlaybackSession,
    Playlist,
    RecentlyPlayed,
    Release,
    RoomParticipant,
    RoomQueueItem,
    StreamEvent,
    Subscription,
    SubscriptionPlan,
    Track,
    User,
)

BASIC_DAILY_STREAM_LIMIT = 60
MAX_AVATAR_BYTES = 50 * 1024 * 1024
MAX_COVER_BYTES = 50 * 1024 * 1024
MAX_AUDIO_BYTES = 250 * 1024 * 1024
MAX_TICKET_ATTACHMENT_BYTES = 25 * 1024 * 1024
logger = logging.getLogger(__name__)
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
AUDIO_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac"}


def now_utc() -> datetime:
    return timezone.now()


def public_url(request, value: str | None) -> str | None:  # type: ignore[no-untyped-def]
    if not value:
        return None
    if value.startswith(("http://", "https://", "/")):
        return value
    return request.build_absolute_uri(settings.MEDIA_URL + value)


def active_subscription(user: User) -> Subscription:
    sub = user.subscriptions.filter(status=Subscription.Status.ACTIVE).order_by("-starts_at").first()
    if not sub:
        return Subscription.basic_for(user)
    if sub.tier != Subscription.Tier.BASIC and sub.expires_at and sub.expires_at <= now_utc():
        sub.status = Subscription.Status.EXPIRED
        sub.save(update_fields=["status", "updated_at"])
        return Subscription.basic_for(user)
    return sub


def playlist_limit(tier: str) -> int:
    if tier == Subscription.Tier.BASIC:
        return 6
    if tier == Subscription.Tier.SILVER:
        return 100
    return 1_000_000


def age_from_birth_date(birth_date: date, at: datetime | None = None) -> int:
    at = at or now_utc()
    today = at.date()
    age = today.year - birth_date.year
    if (today.month, today.day) < (birth_date.month, birth_date.day):
        age -= 1
    return age


def local_day(user: User, at: datetime | None = None) -> str:
    at = at or now_utc()
    try:
        zone = ZoneInfo(user.timezone)
    except Exception:
        zone = ZoneInfo("UTC")
    return at.astimezone(zone).strftime("%Y-%m-%d")


def track_lock(user: User, track: Track, at: datetime | None = None) -> str | None:
    at = at or now_utc()
    sub = active_subscription(user)
    if track.is_explicit and (age_from_birth_date(user.birth_date, at) < 18 or not user.explicit_content_enabled):
        return "explicit_restricted"
    if track.release.early_access_starts_at and track.release.public_release_at > at and sub.tier != Subscription.Tier.GOLD:
        return "gold_required"
    if sub.tier == Subscription.Tier.BASIC:
        day = local_day(user, at)
        count = StreamEvent.objects.filter(user=user, local_day=day).values("track_id").distinct().count()
        already = StreamEvent.objects.filter(user=user, track=track, local_day=day).exists()
        if count >= BASIC_DAILY_STREAM_LIMIT and not already:
            return "daily_stream_limit"
    return None


def ensure_consumer(user: User) -> None:
    if user.kind != User.Kind.CONSUMER:
        raise SonoraError("forbidden", "This action is not available for staff accounts.", status.HTTP_403_FORBIDDEN)


def ensure_staff(user: User) -> None:
    if user.kind not in {User.Kind.SUPPORT, User.Kind.ADMIN}:
        raise SonoraError("forbidden", "Staff access required.", status.HTTP_403_FORBIDDEN)


def ensure_admin(user: User) -> None:
    if user.kind != User.Kind.ADMIN:
        raise SonoraError("forbidden", "Admin access required.", status.HTTP_403_FORBIDDEN)


def ensure_verified_artist(user: User) -> None:
    profile = getattr(user, "artist_profile", None)
    if not profile or not profile.verified_at:
        raise SonoraError("verified_required", "Only verified artists can manage releases.", status.HTTP_403_FORBIDDEN)


def can_open_ticket(user: User) -> bool:
    sub = active_subscription(user)
    return sub.tier != Subscription.Tier.BASIC or bool(getattr(getattr(user, "artist_profile", None), "verified_at", None))


def can_edit_avatar(user: User) -> bool:
    return active_subscription(user).tier in {Subscription.Tier.SILVER, Subscription.Tier.GOLD}


def can_download(user: User) -> bool:
    return active_subscription(user).tier in {Subscription.Tier.SILVER, Subscription.Tier.GOLD}


def create_audit(actor: User | None, action: str, target: object, before: object | None, after: object | None, request_id: str) -> AuditEvent:
    return AuditEvent.objects.create(actor=actor, action=action, target=str(target), before=before, after=after, request_id=request_id)


def create_notification(user: User, title: str, body: str, kind: str = Notification.Kind.IMPORTANT, title_key: str = "", body_key: str = "", values: dict | None = None) -> Notification:
    return Notification.objects.create(user=user, title=title, body=body, kind=kind, title_key=title_key, body_key=body_key, values=values or {})


def validate_image(file, max_bytes: int = MAX_AVATAR_BYTES) -> Image.Image:  # type: ignore[no-untyped-def]
    if file.size > max_bytes:
        raise SonoraError("file_too_large", "Image exceeds the upload size limit.")
    content_type = getattr(file, "content_type", "") or mimetypes.guess_type(file.name)[0] or ""
    if content_type not in IMAGE_TYPES:
        raise SonoraError("file_type_invalid", "Choose a JPEG, PNG, or WebP image.")
    try:
        image = Image.open(file)
        image.verify()
        file.seek(0)
        image = Image.open(file).convert("RGB")
    except Exception as exc:
        raise SonoraError("image_invalid", "The image could not be decoded safely.") from exc
    return image


def derivative_content(image: Image.Image, size: int) -> ContentFile:
    copy = image.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (12, 15, 12))
    offset = ((size - copy.width) // 2, (size - copy.height) // 2)
    canvas.paste(copy, offset)
    output = BytesIO()
    canvas.save(output, format="WEBP", quality=88, method=6)
    return ContentFile(output.getvalue())


def process_avatar(user: User, file) -> User:  # type: ignore[no-untyped-def]
    if not can_edit_avatar(user):
        raise SonoraError("avatar_entitlement", "Profile image edits require Silver or Gold.", status.HTTP_403_FORBIDDEN)
    image = validate_image(file)
    safe_name = f"{user.id}.webp"
    user.avatar_original.save(file.name, file, save=False)
    user.avatar_256.save(safe_name, derivative_content(image, 256), save=False)
    user.avatar_64.save(safe_name, derivative_content(image, 64), save=False)
    user.save(update_fields=["avatar_original", "avatar_256", "avatar_64"])
    return user


def process_cover(release: Release, file) -> Release:  # type: ignore[no-untyped-def]
    image = validate_image(file, MAX_COVER_BYTES)
    safe_name = f"{release.id}.webp"
    release.cover_original.save(file.name, file, save=False)
    release.cover_512.save(safe_name, derivative_content(image, 512), save=False)
    release.cover_128.save(safe_name, derivative_content(image, 128), save=False)
    release.save(update_fields=["cover_original", "cover_512", "cover_128", "updated_at"])
    return release


def validate_audio_file(file) -> None:  # type: ignore[no-untyped-def]
    if file.size > MAX_AUDIO_BYTES:
        raise SonoraError("file_too_large", "Audio exceeds the upload size limit.")
    content_type = getattr(file, "content_type", "") or mimetypes.guess_type(file.name)[0] or ""
    if content_type not in AUDIO_TYPES:
        raise SonoraError("file_type_invalid", "Choose an MP3, WAV, or FLAC file.")


def wav_duration(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
        return max(1, round(frames / rate))


def process_audio(track: Track) -> Track:
    if not track.original_audio:
        track.processing_state = "failed"
        track.processing_error = "No original audio file was provided."
        track.save(update_fields=["processing_state", "processing_error", "updated_at"])
        return track
    source = Path(track.original_audio.path)
    processed_dir = Path(settings.MEDIA_ROOT) / "audio" / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    target = processed_dir / f"{track.id}.mp3"
    ffmpeg = settings.SONORA_FFMPEG_BINARY
    try:
        subprocess.run([ffmpeg, "-y", "-i", str(source), "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", str(target)], check=True, capture_output=True)
        track.processed_audio.name = f"audio/processed/{track.id}.mp3"
        track.duration_seconds = wav_duration(source) if source.suffix.lower() == ".wav" else max(track.duration_seconds, 1)
        track.processing_state = "ready"
        track.processing_error = ""
    except Exception as exc:
        if source.suffix.lower() == ".wav":
            target = processed_dir / f"{track.id}.wav"
            shutil.copyfile(source, target)
            track.processed_audio.name = f"audio/processed/{track.id}.wav"
            track.duration_seconds = wav_duration(source)
            track.processing_state = "ready"
            track.processing_error = "FFmpeg unavailable locally; WAV rendition copied for development playback."
        else:
            track.processing_state = "failed"
            track.processing_error = f"FFmpeg processing failed: {exc}"
    track.save(update_fields=["processed_audio", "duration_seconds", "processing_state", "processing_error", "updated_at"])
    if track.release.tracks.filter(processing_state="failed").exists():
        track.release.status = Release.Status.PROCESSING
    elif track.release.tracks.exists() and not track.release.tracks.exclude(processing_state="ready").exists():
        track.release.status = Release.Status.READY
    track.release.save(update_fields=["status", "updated_at"])
    return track


def create_or_replace_subscription(user: User, payment: Payment) -> Subscription:
    active = active_subscription(user)
    if active.tier == payment.tier and active.status == Subscription.Status.ACTIVE:
        raise SonoraError("same_tier_active", "An active subscription cannot be extended or stacked.")
    if active.tier == Subscription.Tier.GOLD and payment.tier == Subscription.Tier.SILVER and active.expires_at and active.expires_at > now_utc():
        raise SonoraError("downgrade_blocked", "Silver becomes available after your Gold plan expires.")
    if active.status == Subscription.Status.ACTIVE:
        active.status = Subscription.Status.SUPERSEDED
        active.save(update_fields=["status", "updated_at"])
    starts = now_utc()
    expires = starts + timedelta(days=30 * payment.duration_months)
    return Subscription.objects.create(user=user, tier=payment.tier, status=Subscription.Status.ACTIVE, starts_at=starts, expires_at=expires, source_payment=payment)


@transaction.atomic
def purchase_plan(user: User, plan: SubscriptionPlan, provider: str = Payment.Provider.MOCK) -> Payment:
    final_price = plan.final_price_rial
    active = active_subscription(user)
    if active.tier == plan.tier and active.status == Subscription.Status.ACTIVE:
        raise SonoraError("same_tier_active", "An active subscription cannot be extended or stacked.")
    if active.tier == Subscription.Tier.GOLD and plan.tier == Subscription.Tier.SILVER and active.expires_at and active.expires_at > now_utc():
        raise SonoraError("downgrade_blocked", "Silver becomes available after your Gold plan expires.")
    payment = Payment.objects.create(
        user=user,
        plan=plan,
        tier=plan.tier,
        duration_months=plan.duration_months,
        monthly_price_rial=plan.monthly_price_rial,
        discount_percent=plan.discount_percent,
        final_price_rial=final_price,
        provider=provider,
        provider_reference=f"demo-{secrets.token_urlsafe(8)}",
        status=Payment.Status.SUCCEEDED if provider == Payment.Provider.MOCK else Payment.Status.PENDING,
    )
    if payment.status == Payment.Status.SUCCEEDED:
        create_or_replace_subscription(user, payment)
        create_notification(user, f"{plan.tier.title()} activated", "Backend mock payment completed. No real payment was charged.", Notification.Kind.CRITICAL, "noticePaymentTitle", "noticePaymentBody", {"tier": plan.tier.title()})
    return payment


def create_playback_session(user: User, track: Track, room: ListeningRoom | None = None) -> PlaybackSession:
    if track.processing_state != "ready" or not track.public_audio_url:
        raise SonoraError("track_unavailable", "This track is not ready for playback.", status.HTTP_409_CONFLICT)
    if track.release.status not in {Release.Status.PUBLISHED, Release.Status.SCHEDULED, Release.Status.READY}:
        raise SonoraError("track_unavailable", "This track is not publicly playable.", status.HTTP_409_CONFLICT)
    lock = track_lock(user, track)
    if lock:
        raise SonoraError(lock, "This track is not playable for your account.", status.HTTP_403_FORBIDDEN)
    session = PlaybackSession.objects.create(user=user, track=track, room=room)
    try:
        RecentlyPlayed.objects.create(user=user, track=track, played_at=now_utc())
        stale_ids = list(RecentlyPlayed.objects.filter(user=user).order_by("-played_at").values_list("id", flat=True)[50:])
        if stale_ids:
            RecentlyPlayed.objects.filter(id__in=stale_ids).delete()
    except OperationalError as exc:
        if connection.vendor == "sqlite" and "database is locked" in str(exc).lower():
            logger.warning("recently_played_write_skipped", extra={"user_id": str(user.id), "track_id": str(track.id)})
        else:
            raise
    return session


def stream_grant(session: PlaybackSession) -> str:
    signer = TimestampSigner(salt="sonora.stream")
    return signer.sign(f"{session.id}:{session.user_id}:{session.track_id}")


def verify_stream_grant(token: str) -> PlaybackSession:
    signer = TimestampSigner(salt="sonora.stream")
    try:
        value = signer.unsign(token, max_age=settings.SONORA_STREAM_SIGNING_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise SonoraError("grant_expired", "Playback grant expired.", status.HTTP_403_FORBIDDEN) from exc
    except BadSignature as exc:
        raise SonoraError("grant_invalid", "Playback grant is invalid.", status.HTTP_403_FORBIDDEN) from exc
    session_id, user_id, track_id = value.split(":", 2)
    session = PlaybackSession.objects.select_related("user", "track").get(id=session_id, user_id=user_id, track_id=track_id)
    if session.expires_at <= now_utc():
        raise SonoraError("grant_expired", "Playback grant expired.", status.HTTP_403_FORBIDDEN)
    return session


def record_progress(session: PlaybackSession, position_seconds: float) -> bool:
    session.last_position_seconds = max(session.last_position_seconds, position_seconds)
    threshold = min(30, session.track.duration_seconds * 0.8)
    recorded = False
    if not session.valid_stream_recorded_at and position_seconds >= threshold:
        day = local_day(session.user)
        event, created = StreamEvent.objects.get_or_create(user=session.user, track=session.track, local_day=day, defaults={"playback_session": session})
        if created:
            first_listener = not StreamEvent.objects.filter(user=session.user, track=session.track).exclude(id=event.id).exists()
            session.valid_stream_recorded_at = now_utc()
            session.track.stream_count = models.F("stream_count") + 1  # type: ignore[name-defined]
            if first_listener:
                session.track.unique_listener_count = models.F("unique_listener_count") + 1  # type: ignore[name-defined]
                session.track.save(update_fields=["stream_count", "unique_listener_count", "updated_at"])
            else:
                session.track.save(update_fields=["stream_count", "updated_at"])
            recorded = True
    session.save(update_fields=["last_position_seconds", "valid_stream_recorded_at", "updated_at"])
    return recorded


def room_invite_code() -> str:
    for _ in range(20):
        code = secrets.token_urlsafe(6).replace("_", "").replace("-", "")[:8].upper()
        if not ListeningRoom.objects.filter(invite_code=code).exists():
            return code
    raise SonoraError("room_code_failed", "Could not create a room invite.")


def can_use_room(user: User) -> bool:
    return active_subscription(user).tier in {Subscription.Tier.SILVER, Subscription.Tier.GOLD}


def ensure_room_access(user: User) -> None:
    if not can_use_room(user):
        raise SonoraError("room_entitlement", "Group Listening requires Silver or Gold.", status.HTTP_403_FORBIDDEN)


@transaction.atomic
def create_room(user: User) -> ListeningRoom:
    ensure_room_access(user)
    room = ListeningRoom.objects.create(invite_code=room_invite_code(), host=user)
    RoomParticipant.objects.create(room=room, user=user, can_control=True)
    return room


@transaction.atomic
def join_room(user: User, invite_code: str) -> ListeningRoom:
    ensure_room_access(user)
    room = ListeningRoom.objects.select_for_update().get(invite_code=invite_code, status=ListeningRoom.Status.ACTIVE)
    active_count = room.participants.filter(left_at__isnull=True).count()
    if active_count >= 10 and not room.participants.filter(user=user, left_at__isnull=True).exists():
        raise SonoraError("room_full", "This room is full.", status.HTTP_409_CONFLICT)
    participant, _ = RoomParticipant.objects.get_or_create(room=room, user=user, defaults={"can_control": False})
    participant.left_at = None
    participant.last_activity_at = now_utc()
    participant.save(update_fields=["left_at", "last_activity_at", "updated_at"])
    return room


@transaction.atomic
def leave_room(user: User, room: ListeningRoom) -> ListeningRoom:
    participant = room.participants.filter(user=user, left_at__isnull=True).first()
    if not participant:
        return room
    participant.left_at = now_utc()
    participant.save(update_fields=["left_at", "updated_at"])
    active = list(room.participants.filter(left_at__isnull=True).order_by("joined_at"))
    if not active:
        room.status = ListeningRoom.Status.CLOSED
    elif room.host_id == user.id:
        room.host = active[0].user
        active[0].can_control = True
        active[0].save(update_fields=["can_control", "updated_at"])
    room.save(update_fields=["status", "host", "updated_at"])
    return room


def room_controller(user: User, room: ListeningRoom) -> bool:
    return room.host_id == user.id or room.participants.filter(user=user, left_at__isnull=True, can_control=True).exists()


def add_track_to_room(user: User, room: ListeningRoom, track: Track) -> RoomQueueItem:
    if not room_controller(user, room):
        raise SonoraError("room_control_required", "Controller permission is required.", status.HTTP_403_FORBIDDEN)
    lock = track_lock(user, track)
    if lock:
        raise SonoraError(lock, "You cannot add a track you cannot access.", status.HTTP_403_FORBIDDEN)
    position = room.queue_items.count()
    item = RoomQueueItem.objects.create(room=room, track=track, added_by=user, position=position)
    if not room.current_queue_item:
        room.current_queue_item = item
        room.save(update_fields=["current_queue_item", "updated_at"])
    return item


def participant_access_state(user: User, track: Track | None) -> str:
    if not track:
        return "playable"
    lock = track_lock(user, track)
    return {"gold_required": "tier_locked", "explicit_restricted": "explicit_locked", "daily_stream_limit": "tier_locked"}.get(lock or "", "playable")


def reward_amount_rial(unique_listeners: int, valid_streams: int) -> int:
    toman = round(((unique_listeners * 150) + (valid_streams * 25)) / 1000) * 1000
    return toman * 10
