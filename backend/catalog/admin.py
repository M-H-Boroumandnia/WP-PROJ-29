from __future__ import annotations

from django.contrib import admin

from catalog.models import (
    Like,
    PlaybackSession,
    RecentlyPlayed,
    Release,
    StreamEvent,
    Track,
    TrackArtistCredit,
)

for model in [
    Release,
    Track,
    TrackArtistCredit,
    Like,
    RecentlyPlayed,
    PlaybackSession,
    StreamEvent,
]:
    admin.site.register(model)
