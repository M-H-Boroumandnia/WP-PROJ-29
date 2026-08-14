from __future__ import annotations

from django.urls import path

from playlists.views import (
    PlaybackContextView,
    PlaylistDetailView,
    PlaylistListView,
    PlaylistSaveView,
    PlaylistTrackView,
)

urlpatterns = [
    path("playlists/", PlaylistListView.as_view(), name="playlists"),
    path("playlists/<uuid:pk>/", PlaylistDetailView.as_view(), name="playlist-detail"),
    path("playlists/<uuid:pk>/tracks/", PlaylistTrackView.as_view(), name="playlist-tracks"),
    path(
        "playlists/<uuid:pk>/tracks/<uuid:track_id>/",
        PlaylistTrackView.as_view(),
        name="playlist-track-detail",
    ),
    path("playlists/<uuid:pk>/save/", PlaylistSaveView.as_view(), name="playlist-save"),
    path(
        "playlists/<uuid:pk>/playback-context/",
        PlaybackContextView.as_view(),
        name="playlist-context",
    ),
]
