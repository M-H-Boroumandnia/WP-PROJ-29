from __future__ import annotations

from django.urls import path

from catalog import views

urlpatterns = [
    path("releases/", views.ReleaseListView.as_view(), name="releases"),
    path("releases/<uuid:pk>/", views.ReleaseDetailView.as_view(), name="release-detail"),
    path("tracks/", views.TrackListView.as_view(), name="tracks"),
    path("tracks/<uuid:pk>/", views.TrackDetailView.as_view(), name="track-detail"),
    path("tracks/<uuid:pk>/like/", views.LikeView.as_view(), name="track-like"),
    path(
        "tracks/<uuid:pk>/playback-sessions/",
        views.PlaybackSessionView.as_view(),
        name="playback-session",
    ),
    path(
        "tracks/<uuid:pk>/download-tickets/",
        views.DownloadTicketView.as_view(),
        name="download-ticket",
    ),
    path(
        "playback-sessions/<uuid:pk>/progress/",
        views.PlaybackProgressView.as_view(),
        name="playback-progress",
    ),
    path("media/streams/<path:token>/", views.StreamMediaView.as_view(), name="stream-media"),
    path(
        "media/downloads/<path:token>/",
        views.StreamMediaView.as_view(),
        {"download": True},
        name="download-media",
    ),
    path(
        "artist/verification-requests/",
        views.ArtistVerificationView.as_view(),
        name="artist-verification",
    ),
    path("artist/releases/", views.ArtistReleasesView.as_view(), name="artist-releases"),
    path(
        "artist/releases/<uuid:pk>/",
        views.ArtistReleaseDetailView.as_view(),
        name="artist-release-detail",
    ),
    path(
        "artist/releases/<uuid:pk>/tracks/",
        views.ArtistTrackUploadView.as_view(),
        name="artist-track-upload",
    ),
    path(
        "artist/tracks/<uuid:pk>/",
        views.ArtistTrackDetailView.as_view(),
        name="artist-track-detail",
    ),
    path("artist/analytics/", views.ArtistAnalyticsView.as_view(), name="artist-analytics"),
    path("artist/payouts/", views.ArtistPayoutsView.as_view(), name="artist-payouts"),
]
