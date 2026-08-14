from __future__ import annotations

from datetime import datetime
from typing import Any

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.exceptions import SonoraError
from catalog.models import Release

BASIC_DAILY_STREAM_LIMIT = 60
MAX_AVATAR_BYTES = 50 * 1024 * 1024
MAX_COVER_BYTES = 50 * 1024 * 1024
MAX_AUDIO_BYTES = 250 * 1024 * 1024
MAX_TICKET_ATTACHMENT_BYTES = 25 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
AUDIO_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac"}


def parse_api_datetime(
    value: Any,
    *,
    default: datetime | None = None,
    allow_null: bool = False,
) -> datetime | None:
    if value in (None, "", "null"):
        if allow_null:
            return None
        return default if default is not None else timezone.now()
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        parsed = parse_datetime(text)
        if parsed is None:
            raise SonoraError("invalid_datetime", "Provide a valid ISO datetime.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.utc)
    return parsed


def now_utc() -> datetime:
    return timezone.now()


def is_early_access_active(release: Release, at: datetime | None = None) -> bool:
    """True when early access is configured and the public release time is still ahead."""
    at = at or now_utc()
    early = release.early_access_starts_at
    public = release.public_release_at
    if not early or not public:
        return False
    if isinstance(public, str):
        public = parse_api_datetime(public)
    if isinstance(early, str):
        early = parse_api_datetime(early, allow_null=True)
    return bool(early and public and public > at)


def public_url(request, value: str | None) -> str | None:  # type: ignore[no-untyped-def]
    if not value:
        return None
    if value.startswith(("http://", "https://", "/")):
        return value
    return request.build_absolute_uri(settings.MEDIA_URL + value)
