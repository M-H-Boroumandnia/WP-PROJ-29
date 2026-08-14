from __future__ import annotations

from .artist import (
    ArtistAnalyticsView,
    ArtistPayoutsView,
    ArtistReleaseDetailView,
    ArtistReleasesView,
    ArtistTrackDetailView,
    ArtistTrackUploadView,
    ArtistVerificationView,
)
from .catalog import (
    DownloadTicketView,
    LikeView,
    PlaybackProgressView,
    PlaybackSessionView,
    ReleaseDetailView,
    ReleaseListView,
    StreamMediaView,
    TrackDetailView,
    TrackListView,
)

__all__ = [
    "ReleaseListView",
    "ReleaseDetailView",
    "TrackListView",
    "TrackDetailView",
    "LikeView",
    "PlaybackSessionView",
    "PlaybackProgressView",
    "DownloadTicketView",
    "StreamMediaView",
    "ArtistVerificationView",
    "ArtistReleasesView",
    "ArtistReleaseDetailView",
    "ArtistTrackUploadView",
    "ArtistTrackDetailView",
    "ArtistAnalyticsView",
    "ArtistPayoutsView",
]
