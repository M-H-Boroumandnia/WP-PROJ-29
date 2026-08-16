from __future__ import annotations

from typing import Any

from django.db.models import Sum

from core.exceptions import SonoraError
from accounts.models import User
from catalog.models import (
    Release,
    StreamEvent,
    Track,
)
from billing.services.accounting import (
    artist_reward_snapshot,
    release_period_stats,
    reporting_period,
)
from billing.services.billing import reward_amount_rial
from core.services.common import public_url


def public_artist_listening_stats(user: User) -> dict[str, int]:
    """Lifetime listener/stream totals for public artist profiles (Gold viewers)."""
    tracks = Track.objects.filter(release__owner=user).exclude(
        release__status=Release.Status.ARCHIVED
    )
    catalog_streams = tracks.aggregate(total=Sum("stream_count"))["total"] or 0
    catalog_listeners = tracks.aggregate(total=Sum("unique_listener_count"))["total"] or 0
    event_streams = StreamEvent.objects.filter(track__release__owner=user).count()
    event_listeners = (
        StreamEvent.objects.filter(track__release__owner=user)
        .values("user_id")
        .distinct()
        .count()
    )
    releases = (
        Release.objects.filter(owner=user)
        .exclude(status=Release.Status.ARCHIVED)
        .filter(status__in=[Release.Status.PUBLISHED, Release.Status.SCHEDULED])
        .count()
    )
    return {
        "uniqueListeners": max(int(catalog_listeners), int(event_listeners)),
        "streams": max(int(catalog_streams), int(event_streams)),
        "releases": int(releases),
    }


def artist_catalog_analytics(user: User, request=None) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    profile = getattr(user, "artist_profile", None)
    if not profile:
        raise SonoraError("artist_required", "An artist profile is required.")
    _, start, end = reporting_period()
    reward = artist_reward_snapshot(user)
    releases = (
        Release.objects.filter(owner=user)
        .exclude(status=Release.Status.ARCHIVED)
        .prefetch_related("tracks")
        .order_by("-public_release_at", "-created_at")
    )
    tracks = list(
        Track.objects.filter(release__owner=user)
        .exclude(release__status=Release.Status.ARCHIVED)
        .select_related("release")
    )
    release_rows = []
    for release in releases:
        unique, streams = release_period_stats(release, start, end)
        release_rows.append(
            {
                "id": str(release.id),
                "title": release.title,
                "streams": streams,
                "uniqueListeners": unique,
                "rewardRial": reward_amount_rial(unique, streams),
                "trackCount": release.tracks.count(),
            }
        )
    top_tracks = sorted(tracks, key=lambda track: track.stream_count, reverse=True)[:8]
    return {
        "streams": reward["validStreams"],
        "uniqueListeners": reward["uniqueListeners"],
        "rewardRial": reward["rewardRial"],
        "paidRial": reward["paidRial"],
        "unpaidRial": reward["unpaidRial"],
        "period": reward["period"],
        "tracks": len(tracks),
        "releases": releases.count(),
        "verified": bool(profile.verified_at),
        "streamsByRelease": release_rows,
        "topTracks": [
            {
                "id": str(track.id),
                "title": track.title,
                "releaseTitle": track.release.title,
                "coverUrl": public_url(request, track.release.public_cover_url)
                if request
                else track.release.public_cover_url,
                "streamCount": track.stream_count,
                "uniqueListenerCount": track.unique_listener_count,
            }
            for track in top_tracks
        ],
    }
