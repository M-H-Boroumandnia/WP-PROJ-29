from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db import OperationalError, connection, models
from rest_framework import status

from core.exceptions import SonoraError
from accounts.models import User
from catalog.models import (
    PlaybackSession,
    RecentlyPlayed,
    Release,
    StreamEvent,
    Track,
)
from rooms.models import ListeningRoom
from core.services.access import local_day, track_lock
from core.services.common import now_utc

logger = logging.getLogger(__name__)


def listening_stats(user: User) -> dict[str, Any]:
    """Compute profile listening insights from StreamEvent / PlaybackSession rows."""
    now = now_utc()
    today = local_day(user, now)
    day_rows = StreamEvent.objects.filter(user=user).values_list("local_day", flat=True)
    day_counts: dict[str, int] = {}
    for day in day_rows:
        day_counts[day] = day_counts.get(day, 0) + 1

    daily_streams = day_counts.get(today, 0)

    streak = 0
    cursor = now
    for _ in range(365):
        key = local_day(user, cursor)
        if day_counts.get(key, 0) <= 0:
            break
        streak += 1
        cursor -= timedelta(days=1)

    week_days = [local_day(user, now - timedelta(days=ago)) for ago in range(6, -1, -1)]
    week_bars = [day_counts.get(day, 0) for day in week_days]

    week_ago = now - timedelta(days=7)
    listened_seconds = (
        PlaybackSession.objects.filter(
            user=user,
            started_at__gte=week_ago,
            last_position_seconds__gt=0,
        ).aggregate(total=models.Sum("last_position_seconds"))["total"]
        or 0
    )
    if listened_seconds <= 0:
        track_ids = StreamEvent.objects.filter(user=user, local_day__in=week_days).values_list(
            "track_id", flat=True
        )
        listened_seconds = (
            Track.objects.filter(id__in=track_ids).aggregate(total=models.Sum("duration_seconds"))[
                "total"
            ]
            or 0
        )

    return {
        "minutesListened": int(float(listened_seconds) // 60),
        "dailyStreams": int(daily_streams),
        "listeningStreak": int(streak),
        "weekBars": week_bars,
    }


def create_playback_session(
    user: User, track: Track, room: ListeningRoom | None = None
) -> PlaybackSession:
    if track.processing_state != "ready" or not track.public_audio_url:
        raise SonoraError(
            "track_unavailable", "This track is not ready for playback.", status.HTTP_409_CONFLICT
        )
    if track.release.status not in {
        Release.Status.PUBLISHED,
        Release.Status.SCHEDULED,
        Release.Status.READY,
    }:
        raise SonoraError(
            "track_unavailable", "This track is not publicly playable.", status.HTTP_409_CONFLICT
        )
    lock = track_lock(user, track)
    if lock:
        raise SonoraError(
            lock, "This track is not playable for your account.", status.HTTP_403_FORBIDDEN
        )
    session = PlaybackSession.objects.create(user=user, track=track, room=room)
    try:
        RecentlyPlayed.objects.create(user=user, track=track, played_at=now_utc())
        stale_ids = list(
            RecentlyPlayed.objects.filter(user=user)
            .order_by("-played_at")
            .values_list("id", flat=True)[50:]
        )
        if stale_ids:
            RecentlyPlayed.objects.filter(id__in=stale_ids).delete()
    except OperationalError as exc:
        if connection.vendor == "sqlite" and "database is locked" in str(exc).lower():
            logger.warning(
                "recently_played_write_skipped",
                extra={"user_id": str(user.id), "track_id": str(track.id)},
            )
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
        raise SonoraError(
            "grant_expired", "Playback grant expired.", status.HTTP_403_FORBIDDEN
        ) from exc
    except BadSignature as exc:
        raise SonoraError(
            "grant_invalid", "Playback grant is invalid.", status.HTTP_403_FORBIDDEN
        ) from exc
    session_id, user_id, track_id = value.split(":", 2)
    session = PlaybackSession.objects.select_related("user", "track").get(
        id=session_id, user_id=user_id, track_id=track_id
    )
    if session.expires_at <= now_utc():
        raise SonoraError("grant_expired", "Playback grant expired.", status.HTTP_403_FORBIDDEN)
    return session


def record_progress(
    session: PlaybackSession, position_seconds: float, *, finalize: bool = False
) -> bool:
    """Update listen position; count a stream only when the track finishes."""
    session.last_position_seconds = max(session.last_position_seconds, position_seconds)
    recorded = False
    duration = float(session.track.duration_seconds or 0)
    # Near the natural end (handles ended slightly early / float drift).
    reached_end = duration > 0 and position_seconds >= max(duration * 0.95, duration - 1.5)
    if finalize and reached_end and not session.valid_stream_recorded_at:
        session.valid_stream_recorded_at = now_utc()
        StreamEvent.objects.create(
            user=session.user,
            track=session.track,
            local_day=local_day(session.user),
            playback_session=session,
        )
        prior_listens = StreamEvent.objects.filter(
            user=session.user, track=session.track
        ).count()
        session.track.stream_count = models.F("stream_count") + 1  # type: ignore[name-defined]
        update_fields = ["stream_count", "updated_at"]
        if prior_listens == 1:
            session.track.unique_listener_count = models.F("unique_listener_count") + 1  # type: ignore[name-defined]
            update_fields = ["stream_count", "unique_listener_count", "updated_at"]
        session.track.save(update_fields=update_fields)
        recorded = True
    session.save(update_fields=["last_position_seconds", "valid_stream_recorded_at", "updated_at"])
    return recorded
